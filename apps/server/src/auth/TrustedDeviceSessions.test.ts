import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const layer = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-trusted-device-test-" })),
  Layer.provideMerge(TestClock.layer()),
);

const client = { deviceType: "desktop", os: "macOS" } as const;
const scopes = ["orchestration:read"] as const;

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("trusted device sessions", (it) => {
  it.effect.each(["browser", "bearer"] as const)(
    "keeps a paired %s authorized beyond thirty days until revocation",
    (method) =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const pairing = yield* auth.issuePairingCredential({ scopes });
        const token =
          method === "browser"
            ? (yield* auth.createBrowserSession(pairing.credential, client)).sessionToken
            : (yield* auth.exchangeBootstrapCredentialForAccessToken(
                pairing.credential,
                scopes,
                client,
              )).access_token;
        const paired = yield* sessions.verify(token);
        const invalidated = yield* Deferred.make<void>();
        const watcher = yield* sessions.awaitInvalidation(paired.sessionId).pipe(
          Effect.andThen(Deferred.succeed(invalidated, undefined)),
          Effect.forkScoped({ startImmediately: true }),
        );

        yield* TestClock.adjust(Duration.days(31));
        expect(yield* Deferred.isDone(invalidated)).toBe(false);
        expect((yield* sessions.verify(token)).scopes).toEqual(scopes);
        expect((yield* sessions.listActive()).map((session) => session.sessionId)).toContain(
          paired.sessionId,
        );

        const ticket = yield* sessions.issueWebSocketToken(paired.sessionId);
        yield* TestClock.adjust(Duration.minutes(6));
        expect((yield* Effect.flip(sessions.verifyWebSocketToken(ticket.token)))._tag).toBe(
          "WebSocketTokenExpiredError",
        );
        yield* sessions.revoke(paired.sessionId);
        yield* Fiber.join(watcher);
        expect((yield* Effect.flip(sessions.verify(token)))._tag).toBe("SessionTokenRevokedError");
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("keeps unpaired credentials and unused invitations time limited", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const invitation = yield* auth.issuePairingCredential({ scopes, ttl: Duration.minutes(5) });
      const temporary = yield* sessions.issue({ scopes, ttl: Duration.minutes(5) });
      const ordinary = yield* sessions.issue({ scopes });

      yield* TestClock.adjust(Duration.minutes(6));
      expect((yield* Effect.flip(sessions.verify(temporary.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
      expect(
        (yield* Effect.flip(auth.createBrowserSession(invitation.credential, client)))._tag,
      ).toBe("ServerAuthInvalidCredentialError");
      yield* TestClock.adjust(Duration.days(31));
      expect((yield* Effect.flip(sessions.verify(ordinary.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
    }).pipe(Effect.provide(layer)),
  );
});
