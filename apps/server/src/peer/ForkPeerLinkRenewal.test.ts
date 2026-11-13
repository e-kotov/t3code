import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { NodeHttpServer } from "@effect/platform-node";
import { FORK_SESSION_RENEWAL_PATH, type ManagedPolicyDocument } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
} from "effect/http";

import * as ForkSessionRenewalHttp from "../auth/forkSessionRenewalHttp.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ForkPeerLinkRenewal from "./ForkPeerLinkRenewal.ts";
import * as PeerLinks from "./PeerLinks.ts";
import { descriptorOf, layerLinkingEnvironment, linkTo, servePeer } from "./PeerLinks.testkit.ts";

const laptop = descriptorOf("environment-laptop", "Laptop");
const box = descriptorOf("environment-box", "Box");
const day = (days: number) => Duration.toMillis(Duration.days(days));

/**
 * The peer's renewal route, which records each renewal request and, while a
 * gate is set, holds it there before answering.
 */
const renewalRoutes = (
  requests: Queue.Queue<void>,
  gate: Ref.Ref<Option.Option<Deferred.Deferred<void>>>,
  options: { readonly policy?: ManagedPolicyDocument; readonly env?: Record<string, string> } = {},
) =>
  Layer.mergeAll(
    ForkSessionRenewalHttp.routeLayer.pipe(
      Layer.provide(ManagedPolicy.layerTest(options.policy)),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} }))),
    ),
    HttpRouter.middleware(
      (httpEffect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method === "POST" && request.url.startsWith(FORK_SESSION_RENEWAL_PATH)) {
            yield* Queue.offer(requests, undefined);
            const held = yield* Ref.get(gate);
            if (Option.isSome(held)) yield* Deferred.await(held.value);
          }
          return yield* httpEffect;
        }),
      { global: true },
    ),
  );

const servePeerWithRenewal = (options?: Parameters<typeof renewalRoutes>[2]) =>
  Effect.gen(function* () {
    const requests = yield* Queue.unbounded<void>();
    const gate = yield* Ref.make(Option.none<Deferred.Deferred<void>>());
    const peer = yield* servePeer(box, Layer.empty, renewalRoutes(requests, gate, options));
    return { ...peer, requests, gate };
  });

/** One secret store the test reads alongside the linking environment. */
const buildSecrets = Layer.build(
  ServerSecretStore.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-peer-renewal-secrets-" })),
    Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  ),
).pipe(Effect.map((context) => Context.get(context, ServerSecretStore.ServerSecretStore)));

const makeA = (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
  peerLinks: typeof PeerLinks.layer = PeerLinks.layer,
) =>
  layerLinkingEnvironment(
    laptop,
    Layer.succeed(ServerSecretStore.ServerSecretStore, secrets),
    Sqlite.layerMemory,
    peerLinks,
  ).pipe(
    Layer.build,
    Effect.map((context) => ({
      links: Context.get(context, PeerLinks.PeerLinks),
      sql: Context.get(context, SqlClient.SqlClient),
      settings: Context.get(context, ServerSettings.ServerSettingsService),
    })),
  );

const renewalFor = (
  a: Effect.Success<ReturnType<typeof makeA>>,
  secrets: ServerSecretStore.ServerSecretStore["Service"],
) =>
  ForkPeerLinkRenewal.makeRenewal.pipe(
    Effect.provideService(PeerLinks.PeerLinks, a.links),
    Effect.provideService(SqlClient.SqlClient, a.sql),
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
    Effect.provide(FetchHttpClient.layer),
  );

const storedLink = (sql: SqlClient.SqlClient) =>
  sql<{ readonly secret_name: string; readonly expires_at: string }>`
    SELECT secret_name, expires_at FROM peer_environment_links
  `.pipe(Effect.map((rows) => rows[0]));

const tokenIn = (secrets: ServerSecretStore.ServerSecretStore["Service"], name: string) =>
  secrets.get(name).pipe(Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))));

const post = (url: string, headers: Record<string, string>) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client.execute(
        HttpClientRequest.post(new URL(FORK_SESSION_RENEWAL_PATH, url).toString()).pipe(
          HttpClientRequest.setHeaders(headers),
        ),
      ),
    ),
    Effect.flatMap((response) =>
      response.text.pipe(
        Effect.map((text) => ({
          status: response.status,
          body: text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>),
        })),
      ),
    ),
    Effect.provide(FetchHttpClient.layer),
  );

it.effect("renews a paired device's token over HTTP, from its bearer header only", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const b = yield* servePeerWithRenewal();
      const pairing = yield* b.auth.issuePairingCredential();
      const paired = yield* b.auth.exchangeBootstrapCredentialForAccessToken(
        pairing.credential,
        undefined,
        { deviceType: "mobile" },
      );
      yield* TestClock.adjust(Duration.days(2));

      expect(yield* post(b.url, {})).toMatchObject({
        status: 401,
        body: { status: "refused", reason: "missing_credential" },
      });
      // A browser sends cookies by itself, so a cookie never renews anything.
      expect(yield* post(b.url, { cookie: `t3_session=${paired.access_token}` })).toMatchObject({
        status: 401,
        body: { status: "refused", reason: "missing_credential" },
      });
      const answer = yield* post(b.url, { authorization: `Bearer ${paired.access_token}` });
      expect(answer).toMatchObject({
        status: 200,
        body: {
          status: "renewed",
          environmentId: box.environmentId,
          expiresIn: Duration.toSeconds(Duration.days(30)),
        },
      });
      const sessions = yield* b.auth.listSessions();
      expect(sessions.map((session) => session.expiresAt.epochMilliseconds)).toEqual([day(32)]);
      // The renewed token is the device's token now; the old one keeps its own expiry.
      const renewedToken = String(answer.body?.token);
      expect(yield* post(b.url, { authorization: `Bearer ${renewedToken}` })).toMatchObject({
        status: 200,
        body: { status: "unchanged", reason: "not_due" },
      });

      yield* b.auth.revokeSession(sessions[0]!.sessionId);
      expect(yield* post(b.url, { authorization: `Bearer ${renewedToken}` })).toMatchObject({
        status: 401,
        body: { status: "refused", reason: "session_revoked" },
      });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("answers as a host without renewal when turned off or refused by policy", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const off = yield* servePeerWithRenewal({ env: { T3CODE_SESSION_RENEWAL: "false" } });
      const offPairing = yield* off.auth.exchangeBootstrapCredentialForAccessToken(
        (yield* off.auth.issuePairingCredential()).credential,
        undefined,
        { deviceType: "mobile" },
      );
      expect(
        (yield* post(off.url, { authorization: `Bearer ${offPairing.access_token}` })).status,
      ).toBe(404);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("a policy without remote clients lets paired devices lapse", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const local = yield* servePeerWithRenewal({
        policy: {
          schemaVersion: 1,
          organization: "Example Corp",
          limits: { clients: ["desktop"] },
        },
      });
      const paired = yield* local.auth.exchangeBootstrapCredentialForAccessToken(
        (yield* local.auth.issuePairingCredential()).credential,
        undefined,
        { deviceType: "mobile" },
      );
      yield* TestClock.adjust(Duration.days(2));
      expect(
        yield* post(local.url, { authorization: `Bearer ${paired.access_token}` }),
      ).toMatchObject({
        status: 403,
        body: { status: "refused", reason: "not_renewable" },
      });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("keeps a saved agent link renewed on the same session, with its limits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const b = yield* servePeerWithRenewal();
      const secrets = yield* buildSecrets;
      const a = yield* makeA(secrets);
      const renewal = yield* renewalFor(a, secrets);
      yield* linkTo(a.links, b);
      const [linked] = yield* b.linkedSessions;
      const before = yield* storedLink(a.sql);
      const tokenBefore = yield* tokenIn(secrets, before!.secret_name);

      yield* TestClock.adjust(Duration.days(2));
      yield* renewal.renewLink(box.environmentId);
      expect(yield* Queue.size(b.requests)).toBe(1);
      const after = yield* storedLink(a.sql);
      expect(after?.secret_name).toBe(before?.secret_name);
      expect(DateTime.makeUnsafe(after!.expires_at).epochMilliseconds).toBe(day(32));
      expect(yield* tokenIn(secrets, before!.secret_name)).not.toEqual(tokenBefore);
      const sessions = yield* b.linkedSessions;
      expect(sessions.map(({ sessionId, scopes }) => ({ sessionId, scopes }))).toEqual([
        { sessionId: linked!.sessionId, scopes: linked!.scopes },
      ]);
      expect(sessions[0]!.expiresAt.epochMilliseconds).toBe(day(32));

      // Past the original 30 days the link still resolves, and the peer still takes its token.
      yield* TestClock.adjust(Duration.days(29));
      yield* a.links.resolve(box.environmentId);
      yield* renewal.renewLink(box.environmentId);
      expect(yield* Queue.size(b.requests)).toBe(2);
      expect((yield* b.linkedSessions)[0]!.expiresAt.epochMilliseconds).toBe(day(61));

      // With Linked environments off here, nothing is sent.
      yield* a.settings.updateSettings({ linkedEnvironmentsEnabled: false });
      yield* TestClock.adjust(Duration.days(2));
      yield* renewal.renewLink(box.environmentId);
      expect(yield* Queue.size(b.requests)).toBe(2);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("a link forgotten or made again during renewal keeps no stale token", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const b = yield* servePeerWithRenewal();
      const secrets = yield* buildSecrets;
      const a = yield* makeA(secrets);
      const renewal = yield* renewalFor(a, secrets);
      const holdNextRenewal = Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        yield* Ref.set(b.gate, Option.some(gate));
        const renewing = yield* renewal.renewLink(box.environmentId).pipe(Effect.forkScoped);
        yield* Queue.take(b.requests);
        return { gate, renewing };
      });

      yield* linkTo(a.links, b);
      const first = yield* storedLink(a.sql);
      yield* TestClock.adjust(Duration.days(2));
      const unlinking = yield* holdNextRenewal;
      expect(yield* a.links.unlink(box.environmentId)).toBe(true);
      yield* Deferred.succeed(unlinking.gate, undefined);
      yield* Fiber.join(unlinking.renewing);
      expect(yield* a.links.get(box.environmentId)).toEqual(Option.none());
      expect(yield* tokenIn(secrets, first!.secret_name)).toEqual(Option.none());

      yield* linkTo(a.links, b);
      const second = yield* storedLink(a.sql);
      yield* TestClock.adjust(Duration.days(2));
      const relinking = yield* holdNextRenewal;
      yield* linkTo(a.links, b);
      const third = yield* storedLink(a.sql);
      const thirdToken = yield* tokenIn(secrets, third!.secret_name);
      yield* Deferred.succeed(relinking.gate, undefined);
      yield* Fiber.join(relinking.renewing);
      expect(yield* storedLink(a.sql)).toEqual(third);
      expect(yield* tokenIn(secrets, third!.secret_name)).toEqual(thirdToken);
      expect(yield* tokenIn(secrets, second!.secret_name)).toEqual(Option.none());
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("asks a host without renewal at most once a day", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // Turned off, a host answers 404 as one from before the feature does.
      const b = yield* servePeerWithRenewal({ env: { T3CODE_SESSION_RENEWAL: "false" } });
      const secrets = yield* buildSecrets;
      const a = yield* makeA(secrets);
      const renewal = yield* renewalFor(a, secrets);
      yield* linkTo(a.links, b);
      const before = yield* storedLink(a.sql);
      yield* TestClock.adjust(Duration.days(2));
      yield* renewal.renewLink(box.environmentId);
      yield* renewal.renewLink(box.environmentId);
      expect(yield* Queue.size(b.requests)).toBe(1);
      expect(yield* storedLink(a.sql)).toEqual(before);
      yield* TestClock.adjust(Duration.days(1));
      yield* renewal.renewLink(box.environmentId);
      expect(yield* Queue.size(b.requests)).toBe(2);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("an agent using a link asks for its renewal without waiting for it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const b = yield* servePeerWithRenewal();
      const secrets = yield* buildSecrets;
      const a = yield* makeA(secrets, ForkPeerLinkRenewal.renewing(PeerLinks.layer));
      yield* linkTo(a.links, b);
      yield* a.links.resolve(box.environmentId);
      yield* Queue.take(b.requests);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("renews links on a schedule while the server runs, and never after it stops", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const b = yield* servePeerWithRenewal();
      const secrets = yield* buildSecrets;
      const serverScope = yield* Scope.make();
      const a = yield* makeA(secrets, ForkPeerLinkRenewal.renewing(PeerLinks.layer)).pipe(
        Scope.provide(serverScope),
      );
      yield* linkTo(a.links, b);
      // No agent turn: the scheduled pass reaches the link by itself.
      yield* TestClock.adjust(Duration.minutes(1));
      yield* Queue.take(b.requests);

      // Closing waits for the pass and its request to end, so none can start later.
      yield* Scope.close(serverScope, Exit.void);
      const seen = yield* Queue.size(b.requests);
      yield* TestClock.adjust(Duration.days(7));
      expect(yield* Queue.size(b.requests)).toBe(seen);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
