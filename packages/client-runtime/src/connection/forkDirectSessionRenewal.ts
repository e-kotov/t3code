import { FORK_SESSION_RENEWAL_PATH, ForkSessionRenewalResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
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
type RenewalTick = Tick | "retry";

/** The bearer a live lease's HTTP requests present, advanced as renewal proves a newer one. */
export type RenewedBearer = SubscriptionRef.SubscriptionRef<string>;
/** Whether to keep following, and the connection to show next if it changes. */
type FollowStep = readonly [boolean, Option.Option<Option.Option<PreparedConnection>>];

/**
 * Keeps a connected environment's HTTP credential on the token its lease's
 * renewal proved, without reconnecting. It stops for good once the connection
 * shows any other credential, so a newer one set elsewhere always wins.
 * Runs in the background for the caller's scope: the connection attempt's.
 */
export const followRenewedBearer = Effect.fn("ForkDirectSessionRenewal.followRenewedBearer")(
  function* (
    lease: {
      readonly prepared: PreparedConnection;
      readonly forkRenewedBearer?: RenewedBearer | undefined;
    },
    connected: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>,
  ) {
    const bearer = lease.forkRenewedBearer;
    let own = lease.prepared;
    const follow = (renewed: RenewedBearer) =>
      SubscriptionRef.changes(renewed).pipe(
        Stream.runForEachWhile((token) =>
          SubscriptionRef.modifySome(connected, (current): FollowStep => {
            if (Option.isNone(current) || current.value !== own) return [false, Option.none()];
            if (own.httpAuthorization?._tag !== "Bearer" || own.httpAuthorization.token === token) {
              return [true, Option.none()];
            }
            own = { ...own, httpAuthorization: { _tag: "Bearer", token } };
            return [true, Option.some(Option.some(own))];
          }),
        ),
      );
    return yield* (bearer === undefined ? Effect.void : follow(bearer)).pipe(Effect.forkScoped);
  },
);

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
  const inFlight = new Map<string, { readonly semaphore: Semaphore.Semaphore; users: number }>();
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
    bearer: RenewedBearer | undefined,
  ) {
    // The lease presents only a token its own host accepted or issued and this runtime kept.
    const present = (accepted: string) =>
      bearer === undefined ? Effect.void : SubscriptionRef.set(bearer, accepted);
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
        if (swapped) yield* present(answer.value.token);
        yield* Effect.logInfo(
          swapped
            ? "Renewed a direct pairing."
            : "Kept a newer pairing over a renewed one; the renewed token is discarded.",
          { environmentId: prepared.environmentId, expiresIn: answer.value.expiresIn },
        );
        return (swapped ? "again" : "retry") satisfies RenewalTick;
      }
      case "unchanged":
        // Still valid here, though perhaps renewed or paired again since this lease began.
        yield* present(token);
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
  const renewNow = (
    route: ConnectionRoute,
    prepared: PreparedConnection,
    bearer?: RenewedBearer,
  ): Effect.Effect<Tick> => {
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
      // A replacement lease waits and then reads fresh rather than skipping its first check.
      const entry = inFlight.get(credentialId) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 };
      inFlight.set(credentialId, entry);
      entry.users++;
      const check = renewOnce(credentials.value, swap.value, credentialId, route, prepared, bearer);
      return entry.semaphore
        .withPermit(
          check.pipe(
            // A lost swap means another context has a newer token. Ask the host to prove
            // that token now; one retry bounds the work if other contexts keep changing it.
            Effect.filterOrElse(
              (tick): tick is Tick => tick !== "retry",
              () => check,
            ),
            Effect.map((tick): Tick => (tick === "stop" ? "stop" : "again")),
            Effect.orElseSucceed((): Tick => "again"),
          ),
        )
        .pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.users--;
              if (entry.users === 0) inFlight.delete(credentialId);
            }),
          ),
        );
    });
  };

  /** Runs for the lease's lifetime. Never fails, so it can never fail a connection. */
  const keepRenewed = Effect.fn("ForkDirectSessionRenewal.keepRenewed")(
    function* (route: ConnectionRoute, prepared: PreparedConnection, bearer?: RenewedBearer) {
      while ((yield* renewNow(route, prepared, bearer)) === "again") {
        yield* Effect.sleep(CHECK_INTERVAL);
      }
    },
    Effect.ignoreCause({ log: true }),
  );

  /** Renews in the background for the lease's scope; follow the result with `followRenewedBearer`. */
  const renewLease = Effect.fn("ForkDirectSessionRenewal.renewLease")(function* (
    route: ConnectionRoute,
    prepared: PreparedConnection,
  ) {
    const bearer =
      prepared.httpAuthorization?._tag === "Bearer"
        ? yield* SubscriptionRef.make(prepared.httpAuthorization.token)
        : undefined;
    yield* keepRenewed(route, prepared, bearer).pipe(Effect.forkScoped);
    return bearer;
  });

  return { renewNow, keepRenewed, renewLease };
});
