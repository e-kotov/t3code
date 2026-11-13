import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionRoute,
} from "./catalog.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import * as RpcSession from "../rpc/session.ts";
import * as Connectivity from "./connectivity.ts";
import * as ConnectionCredentialStore from "./credentialStore.ts";
import * as ConnectionDriver from "./driver.ts";
import { ForkCredentialSwap } from "./forkCredentialCatalog.ts";
import * as ForkDirectSessionRenewal from "./forkDirectSessionRenewal.ts";
import {
  BearerConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "./model.ts";
import * as ConnectionResolver from "./resolver.ts";
import * as EnvironmentSupervisor from "./supervisor.ts";
import * as ConnectionWakeups from "./wakeups.ts";

const environmentId = EnvironmentId.make("environment-host");
const otherEnvironmentId = EnvironmentId.make("environment-other");

const bearerRoute = (
  connectionId: string,
  httpBaseUrl: string,
  extra: { readonly authorization?: "t3-connect"; readonly network?: "tailscale" } = {},
): ConnectionRoute => ({
  target: new BearerConnectionTarget({ environmentId, label: "Host", connectionId }),
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId,
      environmentId,
      label: "Host",
      httpBaseUrl,
      wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      ...extra,
    }),
  ),
});
const sshRoute: ConnectionRoute = {
  target: new SshConnectionTarget({ environmentId, label: "Host", connectionId: "ssh-1" }),
  profile: Option.none(),
};

const preparedFor = (
  route: ConnectionRoute,
  httpBaseUrl: string,
  httpAuthorization: PreparedConnection["httpAuthorization"] = { _tag: "Bearer", token: "old" },
): PreparedConnection => ({
  environmentId,
  label: "Host",
  httpBaseUrl,
  socketUrl: "ws://unused/ws",
  httpAuthorization,
  target: route.target,
});

describe("which leases renew", () => {
  const paired = bearerRoute("paired-1", "https://host.example/");
  it.each([
    { name: "a paired address", route: paired, expected: "paired-1" },
    {
      name: "a learned route, through the token it borrows",
      route: bearerRoute(
        "learned:environment-host:https://other.example@paired-1",
        "https://other.example/",
      ),
      expected: "paired-1",
    },
    {
      name: "T3 Connect",
      route: bearerRoute("connect-1", "https://host.example/", { authorization: "t3-connect" }),
      expected: undefined,
    },
    { name: "an SSH pairing", route: sshRoute, expected: "ssh-1" },
    {
      name: "the relay",
      route: {
        target: new RelayConnectionTarget({ environmentId, label: "Host" }),
        profile: Option.none(),
      },
      expected: undefined,
    },
  ])("$name", ({ route, expected }) => {
    expect(
      ForkDirectSessionRenewal.renewableCredentialId(
        route,
        preparedFor(route, "https://host.example/"),
      ),
    ).toBe(expected);
  });

  it("not a DPoP lease, even on a paired address", () => {
    expect(
      ForkDirectSessionRenewal.renewableCredentialId(
        paired,
        preparedFor(paired, "https://host.example/", {
          _tag: "Dpop",
          accessToken: "dpop",
          expiresAtEpochMs: 0,
        }),
      ),
    ).toBeUndefined();
  });

  it.each([
    { url: "https://192.168.1.5:3773/", expected: true },
    { url: "http://127.0.0.1:3773/", expected: true },
    { url: "http://host.tail1234.ts.net:3773/", expected: true },
    { url: "http://100.101.102.103:3773/", network: "tailscale" as const, expected: true },
    // Upstream lets a paired token travel there in clear, so renewal adds no exposure.
    { url: "http://100.101.102.103:3773/", expected: true },
    { url: "http://192.168.1.5:3773/", expected: false },
    { url: "http://203.0.113.5:3773/", expected: false },
  ])("renews over $url: $expected", ({ url, network, expected }) => {
    const route = bearerRoute("paired-1", url, network === undefined ? {} : { network });
    expect(
      ForkDirectSessionRenewal.renewsOverProtectedTransport(route, preparedFor(route, url)),
    ).toBe(expected);
  });

  it("renews an SSH pairing over its loopback forward", () => {
    expect(
      ForkDirectSessionRenewal.renewsOverProtectedTransport(
        sshRoute,
        preparedFor(sshRoute, "http://127.0.0.1:41234/"),
      ),
    ).toBe(true);
  });
});

type Responder = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>;

const json =
  (status: number, body: unknown): Responder =>
  (request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

const renewedTo = (token: string, answeredAs = environmentId) =>
  json(200, {
    status: "renewed",
    token,
    environmentId: answeredAs,
    expiresAt: "2026-12-13T00:00:00.000Z",
    expiresIn: 2_592_000,
  });

/** A host, its stored credentials, and every request it received. */
const setup = (stored: Record<string, string>, responder: Responder) =>
  Effect.gen(function* () {
    const tokens = yield* Ref.make(new Map(Object.entries(stored)));
    const respond = yield* Ref.make(responder);
    const requests = yield* Queue.unbounded<{ readonly url: string; readonly token: string }>();
    const swaps = yield* Queue.unbounded<boolean>();
    const client = HttpClient.make((request) =>
      Queue.offer(requests, {
        url: request.url,
        token: (request.headers["authorization"] ?? "").replace(/^Bearer /, ""),
      }).pipe(
        Effect.andThen(Ref.get(respond)),
        Effect.flatMap((current) => current(request)),
      ),
    );
    const credentials = ConnectionCredentialStore.make({
      get: (connectionId) =>
        Ref.get(tokens).pipe(
          Effect.map((map) =>
            Option.map(
              Option.fromUndefinedOr(map.get(connectionId)),
              (token) => new BearerConnectionCredential({ token }),
            ),
          ),
        ),
      put: (connectionId, credential) =>
        Ref.update(tokens, (map) => new Map(map).set(connectionId, credential.token)),
      remove: (connectionId) =>
        Ref.update(tokens, (map) => {
          const next = new Map(map);
          next.delete(connectionId);
          return next;
        }),
    });
    const swap = ForkCredentialSwap.of({
      swap: (connectionId, expected, next) =>
        Ref.modify(tokens, (map) =>
          map.get(connectionId) === expected
            ? [true, new Map(map).set(connectionId, next)]
            : [false, map],
        ).pipe(Effect.tap((swapped) => Queue.offer(swaps, swapped))),
    });
    const stores = Context.make(
      ConnectionCredentialStore.ConnectionCredentialStore,
      credentials,
    ).pipe(Context.add(ForkCredentialSwap, swap));
    const renewal = yield* ForkDirectSessionRenewal.make(client).pipe(
      Effect.provideContext(stores),
    );
    const sent = Queue.clear(requests).pipe(
      Effect.map((all) => all.map((request) => request.token)),
    );
    return { renewal, tokens, respond, requests, swaps, sent, client, stores };
  });

const descriptorOf = (answering: EnvironmentId) =>
  json(200, {
    environmentId: answering,
    label: "Host",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "0.0.0-test",
    capabilities: { repositoryIdentity: true },
  });

const paired = bearerRoute("paired-1", "https://host.example/");
const prepared = preparedFor(paired, "https://host.example/");

describe("ForkDirectSessionRenewal", () => {
  it.effect("stores a renewed token in place of exactly the token it presented", () =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old", "paired-2": "old" }, renewedTo("new"));
      expect(yield* host.renewal.renewNow(paired, prepared)).toBe("again");
      expect(yield* host.sent).toEqual(["old"]);
      expect(Object.fromEntries(yield* Ref.get(host.tokens))).toEqual({
        "paired-1": "new",
        "paired-2": "old",
      });
      // The next attempt reads the stored token afresh.
      yield* Ref.set(host.respond, renewedTo("newer"));
      yield* host.renewal.renewNow(paired, prepared);
      expect(yield* host.sent).toEqual(["new"]);
    }),
  );

  it.effect("keeps a token paired again while a renewal was in flight", () =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old" }, renewedTo("renewed"));
      yield* Ref.set(host.respond, (request) =>
        Ref.update(host.tokens, (map) => new Map(map).set("paired-1", "paired-again")).pipe(
          Effect.andThen(Ref.set(host.respond, notDue)),
          Effect.andThen(renewedTo("renewed")(request)),
        ),
      );
      const bearer = yield* SubscriptionRef.make("old");
      yield* host.renewal.renewNow(paired, prepared, bearer);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("paired-again");
      expect(yield* SubscriptionRef.get(bearer)).toBe("paired-again");
      expect(yield* host.sent).toEqual(["old", "paired-again"]);
    }),
  );

  it.effect.each([
    { name: "a 404", responder: json(404, { error: "not found" }) },
    {
      name: "the web app's page",
      responder: ((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("<!doctype html><title>T3 Code</title>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          ),
        )) satisfies Responder,
    },
    {
      name: "a refusal",
      responder: json(401, { status: "refused", environmentId, reason: "session_revoked" }),
    },
    { name: "another environment's answer", responder: renewedTo("stolen", otherEnvironmentId) },
    {
      name: "the cap",
      responder: json(200, {
        status: "unchanged",
        reason: "cap_reached",
        environmentId,
        expiresAt: "2026-12-13T00:00:00.000Z",
        expiresIn: 60,
      }),
    },
  ])("asks once per connection and keeps the token after $name", ({ responder }) =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old" }, responder);
      // The loop ends by itself, so it neither retries nor fails the connection.
      yield* host.renewal.keepRenewed(paired, prepared);
      expect(yield* host.sent).toEqual(["old"]);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("old");
    }),
  );

  it.effect("asks again later after a network failure or a not-yet-due answer", () =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old" }, (request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause: new Error("offline") }),
          }),
        ),
      );
      expect(yield* host.renewal.renewNow(paired, prepared)).toBe("again");
      yield* Ref.set(
        host.respond,
        json(200, {
          status: "unchanged",
          reason: "not_due",
          environmentId,
          expiresAt: "2026-12-13T00:00:00.000Z",
          expiresIn: 2_592_000,
        }),
      );
      expect(yield* host.renewal.renewNow(paired, prepared)).toBe("again");
      expect(yield* host.sent).toEqual(["old", "old"]);
    }),
  );

  it.effect("never sends the token over plain HTTP on a LAN or public address", () =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old" }, renewedTo("new"));
      const lan = bearerRoute("paired-1", "http://192.168.1.5:3773/");
      // Even when the token itself was paired over that plain HTTP address.
      expect(yield* host.renewal.renewNow(lan, preparedFor(lan, "http://192.168.1.5:3773/"))).toBe(
        "stop",
      );
      expect(yield* host.sent).toEqual([]);
    }),
  );

  it.effect("checks who answers at an address that can change hands before sending it", () =>
    Effect.gen(function* () {
      const tailnet = bearerRoute("paired-1", "http://host.tail1234.ts.net:3773/");
      const tailnetLease = preparedFor(tailnet, "http://host.tail1234.ts.net:3773/");
      const host = yield* setup({ "paired-1": "old" }, (request) =>
        request.url.includes("/.well-known/")
          ? descriptorOf(otherEnvironmentId)(request)
          : renewedTo("new")(request),
      );
      expect(yield* host.renewal.renewNow(tailnet, tailnetLease)).toBe("stop");
      expect(yield* host.sent).toEqual([""]);

      yield* Ref.set(host.respond, (request) =>
        request.url.includes("/.well-known/")
          ? descriptorOf(environmentId)(request)
          : renewedTo("new")(request),
      );
      expect(yield* host.renewal.renewNow(tailnet, tailnetLease)).toBe("again");
      expect(yield* host.sent).toEqual(["", "old"]);
    }),
  );

  it.effect("queues a replacement lease and immediately presents the fresh stored token", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const host = yield* setup({ "paired-1": "old" }, (request) =>
        Deferred.await(gate).pipe(Effect.andThen(renewedTo("new")(request))),
      );
      const first = yield* host.renewal.renewNow(paired, prepared).pipe(Effect.forkChild);
      yield* Queue.take(host.requests);
      const bearer = yield* SubscriptionRef.make("old");
      const replacement = yield* host.renewal
        .renewNow(paired, prepared, bearer)
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(0);
      expect(yield* Queue.size(host.requests)).toBe(0);
      yield* Ref.set(host.respond, notDue);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(replacement);
      expect(yield* host.sent).toEqual(["new"]);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("new");
      expect(yield* SubscriptionRef.get(bearer)).toBe("new");
    }),
  );
});

const notDue = json(200, {
  status: "unchanged",
  reason: "not_due",
  environmentId,
  expiresAt: "2026-12-13T00:00:00.000Z",
  expiresIn: 2_592_000,
});

const bearerOf = (prepared: Option.Option<PreparedConnection>) =>
  Option.flatMap(prepared, (value) =>
    value.httpAuthorization?._tag === "Bearer"
      ? Option.some(value.httpAuthorization.token)
      : Option.none(),
  );

type Host = Effect.Success<ReturnType<typeof setup>>;

/** A host that answers its public descriptor as itself, and renewals with `renewal`. */
const asItself =
  (renewal: Responder): Responder =>
  (request) =>
    request.url.includes("/.well-known/") ? descriptorOf(environmentId)(request) : renewal(request);

/** The tokens renewal requests carried, leaving out the descriptor checks before some. */
const renewalsSent = (host: Host) =>
  Queue.clear(host.requests).pipe(
    Effect.map((all) =>
      all
        .filter((request) => !request.url.includes("/.well-known/"))
        .map((request) => request.token),
    ),
  );

/**
 * The real driver and supervisor over `setup`'s host, as a client runs them:
 * each connection presents the token stored for the route when it connects.
 */
const connectThrough = Effect.fn("test.connectThrough")(function* (
  host: Host,
  route: ConnectionRoute,
  httpBaseUrl: string,
  credentialId: string,
) {
  const sessions = yield* Ref.make(0);
  const session: RpcSession.RpcSession = {
    client: {} as WsRpcProtocolClient,
    initialConfig: Effect.never,
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    inboundFrames: Effect.succeed(0),
    closed: Effect.never,
  };
  const driver = yield* ConnectionDriver.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ConnectionResolver.ConnectionResolver)({
          prepare: () =>
            Ref.get(host.tokens).pipe(
              Effect.map((map) =>
                preparedFor(route, httpBaseUrl, {
                  _tag: "Bearer",
                  token: map.get(credentialId) ?? "",
                }),
              ),
            ),
        }),
        Layer.mock(RpcSession.RpcSessionFactory)({
          connect: () => Ref.update(sessions, (count) => count + 1).pipe(Effect.as(session)),
        }),
        Layer.mock(RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization)({}),
        Layer.succeed(HttpClient.HttpClient, host.client),
      ),
    ),
    Effect.provideContext(host.stores),
  );
  const supervisor = yield* EnvironmentSupervisor.make({
    target: route.target,
    profile: route.profile,
    enabled: true,
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ConnectionDriver.ConnectionDriver, driver),
        Layer.succeed(
          Connectivity.Connectivity,
          Connectivity.Connectivity.of({
            status: Effect.succeed<NetworkStatus>("online"),
            changes: Stream.never,
          }),
        ),
        Layer.succeed(
          ConnectionWakeups.ConnectionWakeups,
          ConnectionWakeups.ConnectionWakeups.of({ changes: Stream.never }),
        ),
      ),
    ),
  );
  // Every bearer the connection's HTTP requests would present, in order, up to `last`.
  const presentedUntil = Effect.fnUntraced(function* (last: string) {
    const subscribed = yield* Deferred.make<void>();
    const presented = yield* SubscriptionRef.changes(supervisor.prepared).pipe(
      Stream.tap(() => Deferred.succeed(subscribed, undefined)),
      Stream.map((prepared) => Option.getOrUndefined(bearerOf(prepared))),
      Stream.filter((token): token is string => token !== undefined),
      Stream.changes,
      Stream.takeUntil((token) => token === last),
      Stream.runCollect,
      Effect.forkScoped,
    );
    yield* Deferred.await(subscribed);
    return presented;
  });
  const connected = SubscriptionRef.changes(supervisor.state).pipe(
    Stream.filter((state) => state.phase === "connected"),
    Stream.runHead,
  );
  return { supervisor, sessions, presentedUntil, connected };
});

describe("a connected lease's HTTP credential", () => {
  it.effect.each([
    {
      name: "a paired address",
      route: paired,
      httpBaseUrl: "https://host.example/",
      credentialId: "paired-1",
    },
    {
      name: "a learned route",
      route: bearerRoute(
        "learned:environment-host:https://other.example@paired-1",
        "https://other.example/",
      ),
      httpBaseUrl: "https://other.example/",
      credentialId: "paired-1",
    },
    {
      name: "an SSH pairing",
      route: sshRoute,
      httpBaseUrl: "http://127.0.0.1:41234/",
      credentialId: "ssh-1",
    },
  ])("follows each renewal on $name without reconnecting", ({ route, httpBaseUrl, credentialId }) =>
    Effect.gen(function* () {
      const host = yield* setup({ [credentialId]: "old" }, asItself(renewedTo("new")));
      const connection = yield* connectThrough(host, route, httpBaseUrl, credentialId);
      const presented = yield* connection.presentedUntil("newer");
      yield* connection.supervisor.connect;
      yield* connection.connected;
      expect(yield* Queue.take(host.swaps)).toBe(true);

      yield* Ref.set(host.respond, asItself(renewedTo("newer")));
      // The next check updates the HTTP credential while the original socket stays connected.
      yield* TestClock.adjust(Duration.hours(6));
      expect(yield* Fiber.join(presented)).toEqual(["old", "new", "newer"]);
      expect(yield* renewalsSent(host)).toEqual(["old", "new"]);
      expect((yield* Ref.get(host.tokens)).get(credentialId)).toBe("newer");
      expect(yield* Ref.get(connection.sessions)).toBe(1);
      expect((yield* SubscriptionRef.get(connection.supervisor.state)).phase).toBe("connected");
    }).pipe(Effect.scoped),
  );

  it.effect("never presents a discarded renewal, and takes up a token renewed elsewhere", () =>
    Effect.gen(function* () {
      const host = yield* setup({ "paired-1": "old" }, renewedTo("new"));
      // Another window pairs again while this renewal is in flight, so its token is discarded.
      yield* Ref.set(host.respond, (request) =>
        Ref.update(host.tokens, (map) => new Map(map).set("paired-1", "paired-again")).pipe(
          Effect.andThen(Ref.set(host.respond, notDue)),
          Effect.andThen(renewedTo("discarded")(request)),
        ),
      );
      const connection = yield* connectThrough(host, paired, "https://host.example/", "paired-1");
      const presented = yield* connection.presentedUntil("paired-again");
      yield* connection.supervisor.connect;
      yield* connection.connected;
      expect(yield* Queue.take(host.swaps)).toBe(false);

      // The old token could expire before the next six-hour check: use the accepted one now.
      expect(yield* Fiber.join(presented)).toEqual(["old", "paired-again"]);
      expect(yield* host.sent).toEqual(["old", "paired-again"]);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("paired-again");
      expect(yield* Ref.get(connection.sessions)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "takes a renewal finished before the connection, and yields to any other credential",
    () =>
      Effect.gen(function* () {
        const lease = preparedFor(paired, "https://host.example/");
        const bearer = yield* SubscriptionRef.make("old");
        const connected = yield* SubscriptionRef.make(Option.some(lease));
        // Renewed before the supervisor started following this lease.
        yield* SubscriptionRef.set(bearer, "new");
        const following = yield* ForkDirectSessionRenewal.followRenewedBearer(
          { prepared: lease, forkRenewedBearer: bearer },
          connected,
        );
        yield* SubscriptionRef.changes(connected).pipe(
          Stream.filter((current) => Option.getOrUndefined(bearerOf(current)) === "new"),
          Stream.runHead,
        );

        // Another writer replaced the connection, even with the same token at another origin.
        const replaced = Option.some(
          preparedFor(paired, "https://other.example/", { _tag: "Bearer", token: "new" }),
        );
        yield* SubscriptionRef.set(connected, replaced);
        yield* SubscriptionRef.set(bearer, "renewed-later");
        yield* Fiber.join(following);
        expect(yield* SubscriptionRef.get(connected)).toBe(replaced);
      }).pipe(Effect.scoped),
  );
});
