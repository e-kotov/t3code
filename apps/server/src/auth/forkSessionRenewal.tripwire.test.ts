/**
 * Upstream-assumption tripwires for fork session renewal: upstream behaviour the fork relies on.
 * On failure follow docs/operations/upstream-sync.md#session-renewal-tripwires: compare
 * upstream's change with the fork feature and ask for a decision; never override upstream.
 */ import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";

const TRIPWIRE =
  "Upstream session-lifetime tripwire (docs/operations/upstream-sync.md#session-renewal-tripwires): " +
  "compare upstream's change with fork direct-session renewal and write .claude-needs-decision.md; " +
  "do not override upstream or edit this assertion to make it pass.";

const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provide(ServerSettings.layerTest({ linkedEnvironmentsEnabled: true })),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-renewal-tripwire-" })),
);

const policy = {
  enabled: true,
  window: Duration.days(30),
  maxAge: Option.some(Duration.days(365)),
};

/** Resolves once the socket watcher for `sessionId` closes the socket. */
const watchSocket = (
  sessions: SessionStore.SessionStore["Service"],
  sessionId: SessionStore.IssuedSession["sessionId"],
) =>
  Effect.gen(function* () {
    const closed = yield* Deferred.make<void>();
    const watcher = yield* sessions
      .awaitInvalidation(sessionId)
      .pipe(
        Effect.andThen(Deferred.succeed(closed, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      );
    return { closed, watcher };
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "session renewal tripwires",
  (it) => {
    it.effect(
      "a paired device's token that is never renewed ends at its signed 30-day expiry, socket too",
      () =>
        Effect.gen(function* () {
          const auth = yield* EnvironmentAuth.EnvironmentAuth;
          const sessions = yield* SessionStore.SessionStore;
          const pairing = yield* auth.issuePairingCredential();
          const paired = yield* auth.exchangeBootstrapCredentialForAccessToken(
            pairing.credential,
            undefined,
            { deviceType: "mobile" },
          );
          const session = yield* sessions.verify(paired.access_token);
          expect({ subject: session.subject, method: session.method }, TRIPWIRE).toEqual({
            subject: "one-time-token",
            method: "bearer-access-token",
          });
          expect(paired.expires_in, TRIPWIRE).toBe(Duration.toSeconds(Duration.days(30)));
          const socket = yield* watchSocket(sessions, session.sessionId);

          yield* TestClock.adjust(Duration.millis(Duration.toMillis(Duration.days(30)) - 1));
          yield* sessions.verify(paired.access_token);
          expect(yield* Deferred.isDone(socket.closed), TRIPWIRE).toBe(false);
          yield* TestClock.adjust(Duration.millis(1));
          expect((yield* Effect.flip(sessions.verify(paired.access_token)))._tag, TRIPWIRE).toBe(
            "SessionTokenExpiredError",
          );
          yield* Fiber.join(socket.watcher);
        }).pipe(Effect.scoped, Effect.provide(Layer.merge(layerAuth, TestClock.layer()))),
    );

    it.effect("an agent link's token that is never renewed ends at its signed 30-day expiry", () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;
        const issued = yield* auth.issueMcpClientSession({
          label: "T3 Code · Laptop",
          access: "auto",
          peerLink: true,
          client: { deviceType: "bot" },
        });
        const session = yield* sessions.verify(issued.token);
        expect(
          {
            subject: session.subject,
            method: session.method,
            peerLink: session.peerLink,
            runtimeModeCeiling: session.runtimeModeCeiling,
          },
          TRIPWIRE,
        ).toEqual({
          subject: "mcp-client",
          method: "bearer-access-token",
          peerLink: true,
          runtimeModeCeiling: "auto",
        });
        yield* TestClock.adjust(Duration.days(30));
        expect((yield* Effect.flip(sessions.verify(issued.token)))._tag, TRIPWIRE).toBe(
          "SessionTokenExpiredError",
        );
      }).pipe(Effect.provide(Layer.merge(layerAuth, TestClock.layer()))),
    );

    it.effect("a socket opened before a renewal still closes at the expiry it opened with", () =>
      Effect.gen(function* () {
        const sessions = yield* SessionStore.SessionStore;
        const issued = yield* sessions.issue({
          subject: "one-time-token",
          method: "bearer-access-token",
        });
        const socket = yield* watchSocket(sessions, issued.sessionId);
        yield* TestClock.adjust(Duration.days(2));
        expect((yield* sessions.renewSession(issued.token, policy))._tag).toBe("Renewed");
        yield* TestClock.adjust(Duration.millis(Duration.toMillis(Duration.days(28)) - 1));
        expect(yield* Deferred.isDone(socket.closed), TRIPWIRE).toBe(false);
        yield* TestClock.adjust(Duration.millis(1));
        // The client reconnects with the renewed token it stored.
        yield* Fiber.join(socket.watcher);
      }).pipe(Effect.scoped, Effect.provide(Layer.merge(layerAuth, TestClock.layer()))),
    );

    it.effect("the session surface renewal builds on is unchanged", () =>
      Effect.gen(function* () {
        const sessions = yield* SessionStore.SessionStore;
        const sql = yield* SqlClient.SqlClient;
        const columns = (table: string) =>
          sql<{ readonly name: string }>`SELECT name FROM pragma_table_info(${table})`.pipe(
            Effect.map((rows) => rows.map((row) => row.name).sort()),
          );
        expect(Object.keys(sessions).sort(), TRIPWIRE).toEqual([
          "awaitInvalidation",
          "cookieName",
          "issue",
          "issueWebSocketToken",
          "legacyCookieName",
          "listActive",
          "markConnected",
          "markDisconnected",
          "proofKeyThumbprintOf",
          "renewSession",
          "revoke",
          "revokeAllExcept",
          "revokeByProofKey",
          "streamChanges",
          "verify",
          "verifyWebSocketToken",
        ]);
        expect(yield* columns("auth_sessions"), TRIPWIRE).toEqual([
          "client_app_version",
          "client_browser",
          "client_device_type",
          "client_ip_address",
          "client_label",
          "client_os",
          "client_surface",
          "client_user_agent",
          "expires_at",
          "issued_at",
          "last_connected_at",
          "method",
          "proof_key_thumbprint",
          "revoked_at",
          "scopes",
          "session_id",
          "subject",
        ]);
        expect(yield* columns("peer_environment_links"), TRIPWIRE).toEqual([
          "access",
          "environment_id",
          "expires_at",
          "fenced",
          "label",
          "last_error",
          "last_reached_at",
          "linked_at",
          "secret_name",
          "urls_json",
        ]);
      }).pipe(Effect.provide(layerAuth)),
    );
  },
);
