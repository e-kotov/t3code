import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, mcpClientScopes } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ForkSessionRenewal from "./ForkSessionRenewal.ts";
import type { RenewalPolicy } from "./ForkSessionRenewal.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as SessionStore from "./SessionStore.ts";
import { base64UrlDecodeUtf8 } from "./utils.ts";

const layerSessionStore = SessionStore.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("renewal-test")),
    }),
  ),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-session-renewal-test-" })),
);

const policy: RenewalPolicy = {
  enabled: true,
  window: Duration.days(30),
  maxAge: Option.some(Duration.days(365)),
};

const day = (days: number) => Duration.toMillis(Duration.days(days));
const hour = (hours: number) => Duration.toMillis(Duration.hours(hours));
const pairing = { subject: "one-time-token", method: "bearer-access-token" } as const;
const agentLink = {
  subject: "mcp-client",
  method: "bearer-access-token",
  scopes: mcpClientScopes("auto"),
  runtimeModeCeiling: "auto",
  peerLink: true,
  ttl: Duration.days(30),
} as const;

/** The host's renewal settings, by the suffix after `T3CODE_SESSION_RENEWAL_`. */
const settings = (env: Record<string, string>) =>
  ConfigProvider.fromEnv({
    env: Object.fromEntries(
      Object.entries(env).map(([name, value]) => [`T3CODE_SESSION_RENEWAL_${name}`, value]),
    ),
  });

const readableSettings: ReadonlyArray<{
  readonly name: string;
  readonly env: Record<string, string>;
  readonly window: number;
  readonly maxAge: Option.Option<number>;
}> = [
  { name: "the defaults", env: {}, window: 30, maxAge: Option.some(365) },
  { name: "0 days as no cap", env: { MAX_AGE_DAYS: "0" }, window: 30, maxAge: Option.none() },
  {
    name: "a one-day window and a short cap",
    env: { WINDOW_DAYS: "1", MAX_AGE_DAYS: "45" },
    window: 1,
    maxAge: Option.some(45),
  },
];

const unreadableSettings: ReadonlyArray<Record<string, string>> = [
  { MAX_AGE_DAYS: "-1" },
  { MAX_AGE_DAYS: "-0.5" },
  { MAX_AGE_DAYS: "Infinity" },
  { MAX_AGE_DAYS: "NaN" },
  { WINDOW_DAYS: "0" },
  { WINDOW_DAYS: "0.5" },
  { WINDOW_DAYS: "-30" },
  { WINDOW_DAYS: "Infinity" },
  { WINDOW_DAYS: "1e9" },
];

const claimsOf = (token: string) =>
  JSON.parse(base64UrlDecodeUtf8(token.split(".")[0]!)) as Record<string, unknown>;

const renewed = (
  outcome: Effect.Success<ReturnType<SessionStore.SessionStore["Service"]["renewSession"]>>,
) => {
  if (outcome._tag !== "Renewed") throw new Error(`expected a renewal, got ${outcome._tag}`);
  return outcome;
};

const rowExpiry = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly expires_at: string }>`
      SELECT expires_at FROM auth_sessions WHERE session_id = ${sessionId}
    `;
    return DateTime.makeUnsafe(rows[0]!.expires_at).epochMilliseconds;
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("ForkSessionRenewal", (it) => {
  it.effect(
    "renews a paired bearer for the same session, while the old token keeps its own expiry",
    () =>
      Effect.gen(function* () {
        const sessions = yield* SessionStore.SessionStore;
        const issued = yield* sessions.issue(pairing);
        yield* TestClock.adjust(Duration.days(2));

        const next = renewed(yield* sessions.renewSession(issued.token, policy));
        expect(next.expiresAt.epochMilliseconds).toBe(day(32));
        expect(yield* rowExpiry(issued.sessionId)).toBe(day(32));
        const before = claimsOf(issued.token);
        const after = claimsOf(next.token);
        expect(after).toEqual({ ...before, exp: day(32) });

        // A lost response leaves the old token, which still works until its own expiry.
        yield* TestClock.adjust(Duration.millis(day(28) - 1));
        expect((yield* sessions.verify(issued.token)).sessionId).toBe(issued.sessionId);
        yield* TestClock.adjust(Duration.millis(1));
        expect((yield* Effect.flip(sessions.verify(issued.token)))._tag).toBe(
          "SessionTokenExpiredError",
        );
        const current = yield* sessions.verify(next.token);
        expect(current.sessionId).toBe(issued.sessionId);
        expect(current.subject).toBe("one-time-token");
        // A socket ticket reads the row, so this also proves the row moved with the token.
        const ticket = yield* sessions.issueWebSocketToken(issued.sessionId);
        expect((yield* sessions.verifyWebSocketToken(ticket.token)).sessionId).toBe(
          issued.sessionId,
        );

        // An unrenewed token still dies at its own signed expiry.
        yield* TestClock.adjust(Duration.days(2));
        expect((yield* Effect.flip(sessions.verify(next.token)))._tag).toBe(
          "SessionTokenExpiredError",
        );
        expect((yield* Effect.flip(sessions.renewSession(next.token, policy)))._tag).toBe(
          "SessionTokenExpiredError",
        );
      }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("renews at most once a token a day, from the token's own expiry", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue(pairing);
      yield* TestClock.adjust(Duration.millis(day(1) - 1));
      expect(yield* sessions.renewSession(issued.token, policy)).toMatchObject({
        _tag: "Unchanged",
        reason: "not_due",
      });
      expect(yield* rowExpiry(issued.sessionId)).toBe(day(30));
      yield* TestClock.adjust(Duration.millis(1));
      const first = renewed(yield* sessions.renewSession(issued.token, policy));
      expect(first.expiresAt.epochMilliseconds).toBe(day(31));
      // A stale copy that kept the first token renews it again once that token is due.
      expect((yield* sessions.renewSession(first.token, policy))._tag).toBe("Unchanged");
      yield* TestClock.adjust(Duration.days(1));
      expect((yield* sessions.renewSession(issued.token, policy))._tag).toBe("Renewed");
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("stops at the absolute cap counted from the first pairing", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const capped = { ...policy, maxAge: Option.some(Duration.days(40)) };
      const issued = yield* sessions.issue(pairing);
      yield* TestClock.adjust(Duration.days(20));
      const last = renewed(yield* sessions.renewSession(issued.token, capped));
      expect(last.expiresAt.epochMilliseconds).toBe(day(40));
      expect(claimsOf(last.token).iat).toBe(0);
      yield* TestClock.adjust(Duration.days(5));
      expect(yield* sessions.renewSession(last.token, capped)).toMatchObject({
        _tag: "Unchanged",
        reason: "cap_reached",
      });
      yield* TestClock.adjust(Duration.days(15));
      expect((yield* Effect.flip(sessions.verify(last.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
      // Without a cap, a pairing in use keeps renewing past a year.
      const uncapped = { ...policy, maxAge: Option.none() };
      let token = (yield* sessions.issue(pairing)).token;
      for (let step = 0; step < 20; step++) {
        yield* TestClock.adjust(Duration.days(20));
        token = renewed(yield* sessions.renewSession(token, uncapped)).token;
      }
      expect((yield* sessions.verify(token)).subject).toBe("one-time-token");
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("a one-day window renews in quarter-day steps, before each token expires", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const daily = { ...policy, window: Duration.days(1), maxAge: Option.some(Duration.days(2)) };
      const issued = yield* sessions.issue({ ...pairing, ttl: Duration.days(1) });
      yield* TestClock.adjust(Duration.millis(hour(6) - 1));
      expect(yield* sessions.renewSession(issued.token, daily)).toMatchObject({
        _tag: "Unchanged",
        reason: "not_due",
      });
      yield* TestClock.adjust(Duration.millis(1));
      let token = renewed(yield* sessions.renewSession(issued.token, daily)).token;
      expect(claimsOf(token)).toEqual({ ...claimsOf(issued.token), exp: hour(30) });
      // Each six-hourly check renews, long before the token it presents expires.
      for (const expected of [hour(36), hour(42), hour(48)]) {
        yield* TestClock.adjust(Duration.hours(6));
        const next = renewed(yield* sessions.renewSession(token, daily));
        expect(next.expiresAt.epochMilliseconds).toBe(expected);
        token = next.token;
      }
      // The first token still ends at its own expiry, and the cap still holds.
      expect((yield* Effect.flip(sessions.verify(issued.token)))._tag).toBe(
        "SessionTokenExpiredError",
      );
      yield* TestClock.adjust(Duration.hours(6));
      expect(yield* sessions.renewSession(token, daily)).toMatchObject({
        _tag: "Unchanged",
        reason: "cap_reached",
      });
      yield* TestClock.adjust(Duration.hours(18));
      expect((yield* Effect.flip(sessions.verify(token)))._tag).toBe("SessionTokenExpiredError");
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect.each(readableSettings)(
    "reads $name from the host's settings",
    ({ env, window, maxAge }) =>
      Effect.gen(function* () {
        const read = yield* ForkSessionRenewal.policyConfig.parse(settings(env));
        expect(read.enabled).toBe(true);
        expect(Duration.toMillis(read.window)).toBe(day(window));
        expect(Option.map(read.maxAge, Duration.toMillis)).toEqual(Option.map(maxAge, day));
      }),
  );

  it.effect.each(unreadableSettings)(
    "rejects %o instead of lifting the cap or shortening the window",
    (env) =>
      Effect.gen(function* () {
        expect(
          (yield* Effect.flip(ForkSessionRenewal.policyConfig.parse(settings(env))))._tag,
        ).toBe("ConfigError");
      }),
  );

  it.effect.each([
    { name: "a browser cookie session", input: { subject: "one-time-token" } },
    {
      name: "a T3 Connect DPoP session",
      input: {
        subject: "one-time-token",
        method: "dpop-access-token",
        proofKeyThumbprint: "proof-key",
      },
    },
    {
      name: "a startup-link session",
      input: { subject: "administrative-bootstrap", method: "bearer-access-token" },
    },
    {
      name: "a desktop session",
      input: { subject: "desktop-bootstrap", method: "bearer-access-token" },
    },
    { name: "a CLI session", input: { subject: "cli", method: "bearer-access-token" } },
    {
      name: "a dev-token child session",
      input: { subject: "reusable-dev-token-child", method: "bearer-access-token" },
    },
    {
      name: "an outside MCP client",
      input: { subject: "mcp-client", method: "bearer-access-token", runtimeModeCeiling: "auto" },
    },
    {
      name: "a pairing carrying a mode ceiling",
      input: { ...pairing, runtimeModeCeiling: "approval-required" },
    },
  ] as const)("never renews $name", ({ input }) =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue(input);
      yield* TestClock.adjust(Duration.days(2));
      expect(yield* sessions.renewSession(issued.token, policy)).toEqual({
        _tag: "Refused",
        reason: "not_renewable",
      });
      expect(yield* rowExpiry(issued.sessionId)).toBe(day(30));
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("renews an agent link with its access, mode ceiling and link marker intact", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue(agentLink);
      yield* TestClock.adjust(Duration.days(3));
      const next = renewed(yield* sessions.renewSession(issued.token, policy));
      const verified = yield* sessions.verify(next.token);
      expect(verified).toMatchObject({
        sessionId: issued.sessionId,
        subject: "mcp-client",
        runtimeModeCeiling: "auto",
        peerLink: true,
      });
      expect([...verified.scopes].sort()).toEqual([...mcpClientScopes("auto")].sort());
      expect(claimsOf(next.token)).toMatchObject({ rtc: "auto", plk: 1 });
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("never brings back a revoked or expired session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const sql = yield* SqlClient.SqlClient;
      yield* TestClock.adjust(Duration.days(2));

      const revoked = yield* sessions.issue(pairing);
      yield* sessions.revoke(revoked.sessionId);
      expect((yield* Effect.flip(sessions.renewSession(revoked.token, policy)))._tag).toBe(
        "SessionTokenRevokedError",
      );

      // Renewed, then revoked: every token of the session stops at once.
      const later = yield* sessions.issue(pairing);
      yield* TestClock.adjust(Duration.days(2));
      const next = renewed(yield* sessions.renewSession(later.token, policy));
      yield* sessions.revoke(later.sessionId);
      expect((yield* Effect.flip(sessions.verify(later.token)))._tag).toBe(
        "SessionTokenRevokedError",
      );
      expect((yield* Effect.flip(sessions.verify(next.token)))._tag).toBe(
        "SessionTokenRevokedError",
      );

      // `verify` reads the signed expiry, not the row's; the guarded write still refuses a row
      // that has ended, as when a revocation or expiry lands between the check and the write.
      const ended = yield* sessions.issue(pairing);
      yield* TestClock.adjust(Duration.days(2));
      yield* sql`
        UPDATE auth_sessions SET expires_at = '1970-01-01T00:00:00.000Z'
        WHERE session_id = ${ended.sessionId}
      `;
      expect(yield* sessions.renewSession(ended.token, policy)).toEqual({
        _tag: "Refused",
        reason: "session_expired",
      });
      expect(yield* rowExpiry(ended.sessionId)).toBe(0);
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );

  it.effect("concurrent renewals of one token both work and never move the row back", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* sessions.issue(pairing);
      yield* TestClock.adjust(Duration.days(2));
      const [first, second] = yield* Effect.all(
        [sessions.renewSession(issued.token, policy), sessions.renewSession(issued.token, policy)],
        { concurrency: "unbounded" },
      );
      for (const outcome of [renewed(first), renewed(second)]) {
        expect((yield* sessions.verify(outcome.token)).sessionId).toBe(issued.sessionId);
      }
      expect(yield* rowExpiry(issued.sessionId)).toBe(day(32));
      expect((yield* sessions.listActive()).map((session) => session.sessionId)).toEqual([
        issued.sessionId,
      ]);
    }).pipe(Effect.provide(Layer.merge(layerSessionStore, TestClock.layer()))),
  );
});
