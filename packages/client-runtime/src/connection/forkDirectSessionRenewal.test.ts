import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
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
import * as ConnectionCredentialStore from "./credentialStore.ts";
import { ForkCredentialSwap } from "./forkCredentialCatalog.ts";
import * as ForkDirectSessionRenewal from "./forkDirectSessionRenewal.ts";
import {
  BearerConnectionTarget,
  type PreparedConnection,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "./model.ts";

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
        ),
    });
    const renewal = yield* ForkDirectSessionRenewal.make(client).pipe(
      Effect.provideContext(
        Context.make(ConnectionCredentialStore.ConnectionCredentialStore, credentials).pipe(
          Context.add(ForkCredentialSwap, swap),
        ),
      ),
    );
    const sent = Queue.clear(requests).pipe(
      Effect.map((all) => all.map((request) => request.token)),
    );
    return { renewal, tokens, respond, requests, sent };
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
          Effect.andThen(renewedTo("renewed")(request)),
        ),
      );
      yield* host.renewal.renewNow(paired, prepared);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("paired-again");
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
      const descriptorOf = (answering: EnvironmentId) =>
        json(200, {
          environmentId: answering,
          label: "Host",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        });
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

  it.effect("sends one request at a time for a stored token", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const host = yield* setup({ "paired-1": "old" }, (request) =>
        Deferred.await(gate).pipe(Effect.andThen(renewedTo("new")(request))),
      );
      const first = yield* host.renewal.renewNow(paired, prepared).pipe(Effect.forkChild);
      yield* Queue.take(host.requests);
      expect(yield* host.renewal.renewNow(paired, prepared)).toBe("again");
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      expect(yield* host.sent).toEqual([]);
      expect((yield* Ref.get(host.tokens)).get("paired-1")).toBe("new");
    }),
  );
});
