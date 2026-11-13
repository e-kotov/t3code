import { AuthSessionId, type AuthEnvironmentScope, type RuntimeMode } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import type { AuthSessionRecord } from "../persistence/AuthSessions.ts";

/**
 * Fork: a still-valid direct pairing or agent-link session gets a token for the
 * same session with a later signed expiry. Its old tokens keep their own
 * expiries, revoking the session still ends every token, and nothing renews
 * once the session has expired or been revoked.
 */
export interface RenewalPolicy {
  readonly enabled: boolean;
  /** Each renewal sets the expiry this far from now. */
  readonly window: Duration.Duration;
  /** No renewal reaches past the session's first issue plus this; none means uncapped. */
  readonly maxAge: Option.Option<Duration.Duration>;
}

const DAY_MILLIS = Duration.toMillis(Duration.days(1));

export const DISABLED_POLICY: RenewalPolicy = {
  enabled: false,
  window: Duration.days(30),
  maxAge: Option.none(),
};

/** Longer settings would put a signed expiry past what a date can hold. */
const MAX_DAYS = 100 * 365;

/**
 * `T3CODE_SESSION_RENEWAL=false` turns it off; a max age of 0 days means no cap.
 * Anything else out of range fails, so the host turns renewal off rather than weaken the cap.
 */
export const policyConfig: Config.Config<RenewalPolicy> = Config.all({
  enabled: Config.Boolean("T3CODE_SESSION_RENEWAL").pipe(Config.withDefault(true)),
  windowDays: Config.schema(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(MAX_DAYS)),
    "T3CODE_SESSION_RENEWAL_WINDOW_DAYS",
  ).pipe(Config.withDefault(30)),
  maxAgeDays: Config.schema(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(MAX_DAYS)),
    "T3CODE_SESSION_RENEWAL_MAX_AGE_DAYS",
  ).pipe(Config.withDefault(365)),
}).pipe(
  Config.map(({ enabled, windowDays, maxAgeDays }) => ({
    enabled,
    window: Duration.days(windowDays),
    maxAge: maxAgeDays === 0 ? Option.none() : Option.some(Duration.days(maxAgeDays)),
  })),
);

/**
 * A renewal that would move the expiry by less than this is not due: a day for
 * the default window, less for short ones, so a one-day window still renews on
 * the clients' six-hourly checks before its token expires.
 */
const dueStepMillis = (window: Duration.Duration) =>
  Math.min(DAY_MILLIS, Duration.toMillis(window) / 4);

/** The verified view of a token this needs; `SessionStore.verify` returns it. */
interface RenewableSession {
  readonly sessionId: AuthSessionId;
  readonly method: string;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly expiresAt?: DateTime.DateTime;
  readonly proofKeyThumbprint?: string;
  readonly runtimeModeCeiling?: RuntimeMode;
  readonly peerLink?: true;
}

export type SessionRenewal =
  | { readonly _tag: "Renewed"; readonly token: string; readonly expiresAt: DateTime.Utc }
  | {
      readonly _tag: "Unchanged";
      readonly reason: "not_due" | "cap_reached";
      readonly expiresAt: DateTime.Utc;
    }
  | {
      readonly _tag: "Refused";
      readonly reason: "not_renewable" | "session_expired" | "session_revoked";
    };

class SessionRenewalError extends Schema.TaggedError<SessionRenewalError>()("SessionRenewalError", {
  operation: Schema.Literals(["read_session", "sign", "self_check", "extend_session"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Session renewal failed to ${this.operation}.`;
  }
}

export type RenewSession<E> = (
  token: string,
  policy: RenewalPolicy,
) => Effect.Effect<SessionRenewal, E | SessionRenewalError>;

/**
 * Pairing-link sessions and genuine agent links: bearer only, never DPoP,
 * cookies, startup, CLI or desktop sessions, and never an outside MCP client.
 */
const isRenewable = (session: RenewableSession) =>
  session.method === "bearer-access-token" &&
  session.proofKeyThumbprint === undefined &&
  ((session.subject === "one-time-token" &&
    session.peerLink === undefined &&
    session.runtimeModeCeiling === undefined) ||
    (session.subject === "mcp-client" && session.peerLink === true));

/** The token's own claims must survive renewal unchanged except for its expiry. */
const sameGrant = (before: RenewableSession, after: RenewableSession) =>
  after.sessionId === before.sessionId &&
  after.method === before.method &&
  after.subject === before.subject &&
  after.proofKeyThumbprint === before.proofKeyThumbprint &&
  after.runtimeModeCeiling === before.runtimeModeCeiling &&
  after.peerLink === before.peerLink &&
  after.scopes.length === before.scopes.length &&
  after.scopes.every((scope) => before.scopes.includes(scope));

const ExtendSessionRequest = Schema.Struct({
  sessionId: AuthSessionId,
  subject: Schema.String,
  now: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});

export const make = Effect.fn("ForkSessionRenewal.make")(function* <E, ReadError, SignError>(deps: {
  readonly verify: (token: string) => Effect.Effect<RenewableSession, E>;
  readonly getRow: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<Option.Option<AuthSessionRecord>, ReadError>;
  /** Re-signs the token's own claims with only `exp` changed. */
  readonly resign: (token: string, expiresAt: DateTime.Utc) => Effect.Effect<string, SignError>;
  /** Publishes the session's new expiry to Settings → Connections. */
  readonly publish: (sessionId: AuthSessionId) => Effect.Effect<void>;
}) {
  const sql = yield* SqlClient.SqlClient;

  // One statement, so a revocation either commits first and wins, or commits
  // after and still ends the new token through `verify`'s row check.
  const extendRow = SqlSchema.findAll({
    Request: ExtendSessionRequest,
    Result: Schema.Struct({ sessionId: AuthSessionId }),
    execute: ({ sessionId, subject, now, expiresAt }) =>
      sql`
        UPDATE auth_sessions
        SET expires_at = MAX(expires_at, ${expiresAt})
        WHERE session_id = ${sessionId}
          AND subject = ${subject}
          AND method = 'bearer-access-token'
          AND revoked_at IS NULL
          AND expires_at > ${now}
        RETURNING session_id AS "sessionId"
      `,
  });

  const readRow = (sessionId: AuthSessionId) =>
    deps
      .getRow(sessionId)
      .pipe(
        Effect.mapError((cause) => new SessionRenewalError({ operation: "read_session", cause })),
      );

  /** Why a session that passed `verify` can no longer renew. */
  const refusalFor = Effect.fnUntraced(function* (sessionId: AuthSessionId, now: DateTime.Utc) {
    const row = yield* readRow(sessionId);
    const reason: "not_renewable" | "session_expired" | "session_revoked" = Option.isNone(row)
      ? "not_renewable"
      : row.value.revokedAt !== null
        ? "session_revoked"
        : row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds
          ? "session_expired"
          : "not_renewable";
    return { _tag: "Refused", reason } as const;
  });

  const renew: RenewSession<E> = Effect.fn("ForkSessionRenewal.renew")(function* (
    token: string,
    policy: RenewalPolicy,
  ) {
    const session = yield* deps.verify(token);
    if (!isRenewable(session) || session.expiresAt === undefined) {
      return { _tag: "Refused", reason: "not_renewable" } as const;
    }
    const now = yield* DateTime.now;
    const row = yield* readRow(session.sessionId);
    if (
      Option.isNone(row) ||
      row.value.method !== session.method ||
      row.value.subject !== session.subject
    ) {
      return { _tag: "Refused", reason: "not_renewable" } as const;
    }
    if (
      row.value.revokedAt !== null ||
      row.value.expiresAt.epochMilliseconds <= now.epochMilliseconds
    ) {
      return yield* refusalFor(session.sessionId, now);
    }

    const current = DateTime.toUtc(session.expiresAt);
    const cap = Option.map(policy.maxAge, (maxAge) =>
      DateTime.add(row.value.issuedAt, { milliseconds: Duration.toMillis(maxAge) }),
    );
    if (Option.isSome(cap) && cap.value.epochMilliseconds <= current.epochMilliseconds) {
      return { _tag: "Unchanged", reason: "cap_reached", expiresAt: current } as const;
    }
    const wanted = DateTime.add(now, { milliseconds: Duration.toMillis(policy.window) });
    const capped = Option.isSome(cap) && cap.value.epochMilliseconds < wanted.epochMilliseconds;
    const target = capped && Option.isSome(cap) ? cap.value : wanted;
    // Renewed in steps of at least `dueStepMillis`; the last step up to the cap is always allowed.
    if (
      !capped &&
      target.epochMilliseconds - current.epochMilliseconds < dueStepMillis(policy.window)
    ) {
      return { _tag: "Unchanged", reason: "not_due", expiresAt: current } as const;
    }

    const renewed = yield* deps
      .resign(token, target)
      .pipe(Effect.mapError((cause) => new SessionRenewalError({ operation: "sign", cause })));
    // Fails closed: a token that does not verify as the same grant is never written or returned.
    const checked = yield* deps.verify(renewed).pipe(Effect.option);
    if (Option.isNone(checked)) return yield* refusalFor(session.sessionId, now);
    if (
      !sameGrant(session, checked.value) ||
      checked.value.expiresAt?.epochMilliseconds !== target.epochMilliseconds
    ) {
      return yield* new SessionRenewalError({ operation: "self_check" });
    }

    const extended = yield* extendRow({
      sessionId: session.sessionId,
      subject: session.subject,
      now,
      expiresAt: target,
    }).pipe(
      Effect.mapError((cause) => new SessionRenewalError({ operation: "extend_session", cause })),
    );
    if (extended.length === 0) return yield* refusalFor(session.sessionId, now);
    yield* deps.publish(session.sessionId);
    yield* Effect.logInfo("Renewed a paired session.", {
      sessionId: session.sessionId,
      subject: session.subject,
      expiresAt: DateTime.formatIso(target),
    });
    return { _tag: "Renewed", token: renewed, expiresAt: target } as const;
  });

  return renew;
});
