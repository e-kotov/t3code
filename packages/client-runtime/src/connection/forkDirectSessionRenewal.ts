import { FORK_SESSION_RENEWAL_PATH, ForkSessionRenewalResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import type { ConnectionRoute } from "./catalog.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import { ForkCredentialSwap } from "./forkCredentialCatalog.ts";
import type { PreparedConnection } from "./model.ts";
import { connectionRouteKind, credentialConnectionId, routeKeepsItsHost } from "./routes.ts";

/** The host decides when a renewal is due; asking this often keeps a connected device renewed. */
const CHECK_INTERVAL = Duration.hours(6);
const REQUEST_TIMEOUT = Duration.seconds(15);
const DESCRIPTOR_TIMEOUT_MS = 10_000;

const decodeAnswer = Schema.decodeUnknownEffect(ForkSessionRenewalResponse);

/**
 * Fork: a `fetch` that fails on any redirect, from a platform whose own fetch
 * follows redirects whatever `redirect` says (React Native's). Renewal sends
 * its request through it when one is provided.
 */
export class ForkRenewalFetch extends Context.Service<ForkRenewalFetch, typeof globalThis.fetch>()(
  "@t3tools/client-runtime/connection/forkDirectSessionRenewal/ForkRenewalFetch",
) {}

/**
 * The stored credential a direct pairing's lease presented: a paired address's
 * own, the one a learned route borrows, or an SSH pairing's. T3 Connect,
 * relay and this app's own backend renew differently or not at all.
 */
export const renewableCredentialId = (
  route: ConnectionRoute,
  prepared: PreparedConnection,
): string | undefined => {
  if (prepared.httpAuthorization?._tag !== "Bearer") return undefined;
  switch (route.target._tag) {
    case "BearerConnectionTarget": {
      const profile = Option.getOrNull(route.profile);
      return profile?._tag === "BearerConnectionProfile" && profile.authorization !== "t3-connect"
        ? credentialConnectionId(route.target.connectionId)
        : undefined;
    }
    case "SshConnectionTarget":
      return route.target.connectionId;
    case "PrimaryConnectionTarget":
    case "RelayConnectionTarget":
      return undefined;
  }
};

/**
 * Renewal sends the token and receives its successor, so never over plain
 * HTTP on a LAN or public address: the same addresses a paired token stays off.
 */
export const renewsOverProtectedTransport = (
  route: ConnectionRoute,
  prepared: PreparedConnection,
): boolean => {
  if (prepared.httpBaseUrl.startsWith("https:")) return true;
  if (!prepared.httpBaseUrl.startsWith("http:")) return false;
  const kind = connectionRouteKind(route);
  return kind !== "lan" && kind !== "public" && kind !== "relay";
};

type Tick = "again" | "stop";

/**
 * Fork: keeps a connected direct pairing renewed. The host extends the same
 * session and returns a token with a later expiry; it is stored only where the
 * exact token it replaces is still stored, so a newer pairing always wins.
 */
export const make = Effect.fn("ForkDirectSessionRenewal.make")(function* (
  httpClient: HttpClient.HttpClient,
) {
  const credentials = yield* Effect.serviceOption(
    ConnectionCredentialStore.ConnectionCredentialStore,
  );
  const swap = yield* Effect.serviceOption(ForkCredentialSwap);
  const renewalFetch = yield* Effect.serviceOption(ForkRenewalFetch);
  const inFlight = new Set<string>();
  // The client reads `Fetch` per request, so this replaces the platform's for the request only.
  const viaRenewalFetch = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Option.isSome(renewalFetch)
      ? Effect.provideService(effect, FetchHttpClient.Fetch, renewalFetch.value)
      : effect;

  const renewOnce = Effect.fnUntraced(function* (
    store: ConnectionCredentialStore.ConnectionCredentialStore["Service"],
    swapper: ForkCredentialSwap["Service"],
    credentialId: string,
    route: ConnectionRoute,
    prepared: PreparedConnection,
  ) {
    // Read fresh, so a token renewed or paired again since the lease started is the one sent.
    const stored = Option.getOrUndefined(yield* store.get(credentialId));
    if (stored?._tag !== "BearerConnectionCredential") return "stop" satisfies Tick;
    const token = stored.token;
    // An address that can change hands is asked who it is before it gets the token.
    if (!routeKeepsItsHost(route)) {
      const descriptor = yield* fetchRemoteEnvironmentDescriptor({
        httpBaseUrl: prepared.httpBaseUrl,
        timeoutMs: DESCRIPTOR_TIMEOUT_MS,
      }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient), Effect.option);
      if (Option.isNone(descriptor)) return "again" satisfies Tick;
      if (descriptor.value.environmentId !== prepared.environmentId) return "stop" satisfies Tick;
    }
    const response = yield* httpClient
      .execute(
        HttpClientRequest.post(
          environmentEndpointUrl(prepared.httpBaseUrl, FORK_SESSION_RENEWAL_PATH),
        ).pipe(HttpClientRequest.bearerToken(token), HttpClientRequest.acceptJson),
      )
      .pipe(
        // The token never follows a redirect, wherever it points.
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "error",
          cache: "no-store",
        }),
        viaRenewalFetch,
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.option,
      );
    if (Option.isNone(response)) return "again" satisfies Tick;
    const answer = yield* response.value.json.pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(decodeAnswer),
      Effect.option,
    );
    // An older host, or anything else answering there: not asked again on this connection.
    if (Option.isNone(answer)) return "stop" satisfies Tick;
    if (answer.value.environmentId !== prepared.environmentId) {
      yield* Effect.logWarning("A host answered a session renewal as another environment.", {
        environmentId: prepared.environmentId,
      });
      return "stop" satisfies Tick;
    }
    switch (answer.value.status) {
      case "renewed": {
        const swapped = yield* swapper.swap(credentialId, token, answer.value.token);
        yield* Effect.logInfo(
          swapped
            ? "Renewed a direct pairing."
            : "Kept a newer pairing over a renewed one; the renewed token is discarded.",
          { environmentId: prepared.environmentId, expiresIn: answer.value.expiresIn },
        );
        return "again" satisfies Tick;
      }
      case "unchanged":
        return (answer.value.reason === "cap_reached" ? "stop" : "again") satisfies Tick;
      case "unavailable":
        return "again" satisfies Tick;
      case "refused":
        yield* Effect.logWarning("A host refused to renew this device's pairing.", {
          environmentId: prepared.environmentId,
          reason: answer.value.reason,
        });
        return "stop" satisfies Tick;
    }
  });

  /** One renewal attempt for a lease: "again" to ask later, "stop" when asking cannot help. */
  const renewNow = (route: ConnectionRoute, prepared: PreparedConnection): Effect.Effect<Tick> => {
    const credentialId = renewableCredentialId(route, prepared);
    if (
      credentialId === undefined ||
      Option.isNone(credentials) ||
      Option.isNone(swap) ||
      !renewsOverProtectedTransport(route, prepared)
    ) {
      return Effect.succeed("stop");
    }
    return Effect.suspend(() => {
      // One request per stored token at a time, across this runtime's leases.
      if (inFlight.has(credentialId)) return Effect.succeed<Tick>("again");
      inFlight.add(credentialId);
      return renewOnce(credentials.value, swap.value, credentialId, route, prepared).pipe(
        Effect.orElseSucceed((): Tick => "again"),
        Effect.ensuring(Effect.sync(() => inFlight.delete(credentialId))),
      );
    });
  };

  /** Runs for the lease's lifetime. Never fails, so it can never fail a connection. */
  const keepRenewed = Effect.fn("ForkDirectSessionRenewal.keepRenewed")(
    function* (route: ConnectionRoute, prepared: PreparedConnection) {
      while ((yield* renewNow(route, prepared)) === "again") yield* Effect.sleep(CHECK_INTERVAL);
    },
    Effect.ignoreCause({ log: true }),
  );

  return { renewNow, keepRenewed };
});
