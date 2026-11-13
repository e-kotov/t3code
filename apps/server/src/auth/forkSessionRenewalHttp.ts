import { FORK_SESSION_RENEWAL_PATH, type ForkSessionRenewalResponse } from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { parseBearerToken } from "./EnvironmentAuth.ts";
import * as ForkSessionRenewal from "./ForkSessionRenewal.ts";
import * as SessionStore from "./SessionStore.ts";

const NO_STORE = { "cache-control": "no-store" } as const;

const respond = (status: number, body: ForkSessionRenewalResponse) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });

const lifetime = (expiresAt: DateTime.Utc, now: DateTime.Utc) => ({
  expiresAt: DateTime.formatIso(expiresAt),
  expiresIn: Math.max(0, Math.floor((expiresAt.epochMilliseconds - now.epochMilliseconds) / 1000)),
});

/**
 * Only an `Authorization: Bearer` header is read, so a browser's cookies never
 * renew anything and a cross-site page cannot ask for a renewal.
 */
const handle = Effect.fn("ForkSessionRenewal.handle")(
  function* (services: {
    readonly policy: ForkSessionRenewal.RenewalPolicy;
    readonly sessions: SessionStore.SessionStore["Service"];
    readonly environment: ServerEnvironment.ServerEnvironment["Service"];
    readonly managedPolicy: ManagedPolicy.ManagedPolicy["Service"];
  }) {
    const policy = services.policy;
    // Turned off, the host answers as one without the feature.
    if (!policy.enabled) return HttpServerResponse.empty({ status: 404, headers: NO_STORE });
    const environmentId = yield* services.environment.getEnvironmentId;
    const refuse = (
      status: number,
      reason: Extract<ForkSessionRenewalResponse, { status: "refused" }>["reason"],
    ) =>
      Effect.logDebug("Refused a session renewal.", { reason }).pipe(
        Effect.as(respond(status, { status: "refused", environmentId, reason })),
      );
    const token = parseBearerToken(yield* HttpServerRequest.HttpServerRequest);
    if (token === null) return yield* refuse(401, "missing_credential");
    // A policy without remote clients lets paired devices and agent links end at their expiry.
    if (!ManagedLimits.allowsRemoteClients(services.managedPolicy)) {
      return yield* refuse(403, "not_renewable");
    }
    const outcome = yield* services.sessions.renewSession(token, policy).pipe(
      Effect.catchTags({
        SessionTokenExpiredError: () =>
          Effect.succeed({ _tag: "Credential", reason: "session_expired" } as const),
        SessionTokenRevokedError: () =>
          Effect.succeed({ _tag: "Credential", reason: "session_revoked" } as const),
      }),
      Effect.catchIf(SessionStore.isSessionCredentialInvalidError, () =>
        Effect.succeed({ _tag: "Credential", reason: "invalid_credential" } as const),
      ),
    );
    const now = yield* DateTime.now;
    switch (outcome._tag) {
      case "Credential":
        return yield* refuse(401, outcome.reason);
      case "Refused":
        return yield* refuse(outcome.reason === "not_renewable" ? 403 : 401, outcome.reason);
      case "Unchanged":
        return respond(200, {
          status: "unchanged",
          reason: outcome.reason,
          environmentId,
          ...lifetime(outcome.expiresAt, now),
        });
      case "Renewed":
        return respond(200, {
          status: "renewed",
          token: outcome.token,
          environmentId,
          ...lifetime(outcome.expiresAt, now),
        });
    }
  },
  (effect, services) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Session renewal failed.", { error: causeErrorTag(cause) }).pipe(
          Effect.andThen(services.environment.getEnvironmentId),
          Effect.map((environmentId) => respond(503, { status: "unavailable", environmentId })),
        ),
      ),
    ),
);

/** Fork: `POST /api/fork/auth/session/renew`; see ForkSessionRenewal.ts. */
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const policy = yield* ForkSessionRenewal.policyConfig.pipe(
      Effect.catch((error) =>
        Effect.logWarning("Session renewal is off: its settings could not be read.", {
          error: error.message,
        }).pipe(Effect.as({ ...ForkSessionRenewal.DISABLED_POLICY })),
      ),
    );
    const handler = handle({
      policy,
      sessions: yield* SessionStore.SessionStore,
      environment: yield* ServerEnvironment.ServerEnvironment,
      managedPolicy: yield* ManagedPolicy.ManagedPolicy,
    });
    yield* router.add("POST", FORK_SESSION_RENEWAL_PATH, handler);
  }),
);
