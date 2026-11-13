import {
  EnvironmentId,
  FORK_SESSION_RENEWAL_PATH,
  ForkSessionRenewalResponse,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { causeErrorTag } from "@t3tools/shared/observability";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as PeerLinks from "./PeerLinks.ts";

/** Each link is asked this often; its peer renews at most once a day. */
const SWEEP_INTERVAL = Duration.hours(6);
const FIRST_SWEEP_DELAY = Duration.minutes(1);
/** Using a link asks again no sooner than this. */
const USE_SPACING_MILLIS = Duration.toMillis(Duration.hours(1));
/** A peer without renewal is asked again after this, in case it was updated. */
const UNSUPPORTED_SPACING_MILLIS = Duration.toMillis(Duration.days(1));
const REQUEST_TIMEOUT = Duration.seconds(15);

const decodeAnswer = Schema.decodeUnknownEffect(ForkSessionRenewalResponse);

/**
 * Fork: keeps saved agent links renewed while this server runs. The peer
 * extends the link's own session (ForkSessionRenewal.ts there), so its
 * access, mode ceiling and fence stay what the link was granted.
 */
export const makeRenewal = Effect.gen(function* () {
  const links = yield* PeerLinks.PeerLinks;
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const scope = yield* Scope.Scope;
  // Only the origin `resolve` checked may receive the token: a redirect could forward it anywhere.
  const peerHttpClient = HttpClient.transform(httpClient, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );
  const running = new Set<EnvironmentId>();
  const lastAttempt = new Map<EnvironmentId, number>();
  const unsupportedUntil = new Map<EnvironmentId, number>();

  const renewLink = Effect.fn("ForkPeerLinkRenewal.renewLink")(function* (
    environmentId: EnvironmentId,
  ) {
    if (!(yield* links.enabled)) return;
    const startedAt = yield* Clock.currentTimeMillis;
    if ((unsupportedUntil.get(environmentId) ?? 0) > startedAt) return;
    const rows = yield* sql<{ readonly secret_name: string }>`
      SELECT secret_name FROM peer_environment_links
      WHERE environment_id = ${environmentId} AND fenced = 1
    `;
    const secretName = rows[0]?.secret_name;
    if (secretName === undefined) return;
    // Expired, unfenced or unreachable links end here, and the token only goes
    // to an address that still answers as this peer.
    const resolved = yield* links.resolve(environmentId);
    const stored = yield* secrets.get(secretName);
    // A link made again since the row was read has a token of its own, left alone.
    if (Option.isNone(stored) || new TextDecoder().decode(stored.value) !== resolved.token) return;

    const response = yield* peerHttpClient
      .execute(
        HttpClientRequest.post(new URL(FORK_SESSION_RENEWAL_PATH, resolved.url).toString()).pipe(
          HttpClientRequest.bearerToken(resolved.token),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(Effect.timeout(REQUEST_TIMEOUT));
    const answer = yield* response.json.pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(decodeAnswer),
      Effect.option,
    );
    if (Option.isNone(answer) || answer.value.environmentId !== environmentId) {
      unsupportedUntil.set(environmentId, startedAt + UNSUPPORTED_SPACING_MILLIS);
      return;
    }
    const outcome = answer.value;
    if (outcome.status === "refused" || outcome.status === "unavailable") {
      yield* Effect.logInfo("A linked environment did not renew its link.", {
        environmentId,
        status: outcome.status,
        ...(outcome.status === "refused" ? { reason: outcome.reason } : {}),
      });
      return;
    }
    const answeredAt = yield* DateTime.now;
    const expiresAt = DateTime.formatIso(DateTime.add(answeredAt, { seconds: outcome.expiresIn }));
    if (outcome.status === "unchanged") {
      // Levels the row with its token, as after a stop between the two writes below.
      yield* sql`
        UPDATE peer_environment_links SET expires_at = ${expiresAt}
        WHERE environment_id = ${environmentId} AND secret_name = ${secretName}
          AND fenced = 1 AND expires_at < ${expiresAt}
      `;
      return;
    }
    // Overwritten in place (temp file and rename), so a `resolve` that read the
    // row before this still finds a working token under the same name.
    yield* secrets.set(secretName, new TextEncoder().encode(outcome.token));
    const updated = yield* sql<{ readonly environment_id: string }>`
      UPDATE peer_environment_links SET expires_at = ${expiresAt}
      WHERE environment_id = ${environmentId} AND secret_name = ${secretName} AND fenced = 1
      RETURNING environment_id
    `;
    // Forgotten or linked again meanwhile: nothing comes back, and no token stays behind.
    if (updated.length === 0) yield* secrets.remove(secretName).pipe(Effect.ignore);
    else yield* Effect.logInfo("Renewed a link to another environment.", { environmentId });
  });

  /** Single-flight per link; failures are logged and never reach the caller. */
  const attempt = Effect.fn("ForkPeerLinkRenewal.attempt")(function* (
    environmentId: EnvironmentId,
  ) {
    if (running.has(environmentId)) return;
    running.add(environmentId);
    lastAttempt.set(environmentId, yield* Clock.currentTimeMillis);
    yield* renewLink(environmentId).pipe(
      Effect.catchCause((cause) =>
        // Only the tag: an HTTP failure's cause carries the request that held the token.
        Effect.logDebug("Could not renew a link to another environment.", {
          environmentId,
          error: causeErrorTag(cause),
        }),
      ),
      Effect.ensuring(Effect.sync(() => running.delete(environmentId))),
    );
  });

  /** Using a link asks for its renewal in the background, at most once an hour. */
  const afterUse = (environmentId: EnvironmentId) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        running.has(environmentId) ||
        now - (lastAttempt.get(environmentId) ?? Number.NEGATIVE_INFINITY) < USE_SPACING_MILLIS
          ? Effect.void
          : attempt(environmentId).pipe(Effect.forkIn(scope), Effect.asVoid),
      ),
    );

  const sweep = Effect.gen(function* () {
    if (!(yield* links.enabled)) return;
    const rows = yield* sql<{ readonly environment_id: string }>`
      SELECT environment_id FROM peer_environment_links WHERE fenced = 1
    `;
    yield* Effect.forEach(rows, (row) => attempt(EnvironmentId.make(row.environment_id)), {
      discard: true,
    });
  }).pipe(Effect.ignoreCause({ log: true }));

  return { renewLink, afterUse, sweep };
});

const make = Effect.gen(function* () {
  const links = yield* PeerLinks.PeerLinks;
  const scope = yield* Scope.Scope;
  const { afterUse, sweep } = yield* makeRenewal;
  // Ends with this server's scope, so nothing is renewed after shutdown.
  yield* Effect.gen(function* () {
    yield* Effect.sleep(FIRST_SWEEP_DELAY);
    while (true) {
      yield* sweep;
      yield* Effect.sleep(SWEEP_INTERVAL);
    }
  }).pipe(Effect.forkIn(scope));

  return PeerLinks.PeerLinks.of({
    ...links,
    list: links.list.pipe(
      Effect.tap((summaries) =>
        Effect.forEach(
          summaries,
          (summary) =>
            summary.status === "reachable" ? afterUse(summary.environmentId) : Effect.void,
          { discard: true },
        ),
      ),
    ),
    resolve: (environmentId) =>
      links.resolve(environmentId).pipe(Effect.tap(() => afterUse(environmentId))),
  });
});

/** Wraps the service `peerLinks` builds with background link renewal. */
export const renewing = <E, R>(peerLinks: Layer.Layer<PeerLinks.PeerLinks, E, R>) =>
  Layer.effect(PeerLinks.PeerLinks, make).pipe(Layer.provide(peerLinks));
