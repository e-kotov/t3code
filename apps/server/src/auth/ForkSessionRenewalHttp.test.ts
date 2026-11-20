import { NodeHttpServer } from "@effect/platform-node";
import { FORK_SESSION_RENEWAL_PATH, type ManagedPolicyDocument } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { descriptorOf, servePeer } from "../peer/PeerLinks.testkit.ts";
import * as ForkSessionRenewalHttp from "./forkSessionRenewalHttp.ts";

const box = descriptorOf("environment-box", "Box");
const day = (days: number) => Duration.toMillis(Duration.days(days));

/** A host serving the client renewal route, with its own policy and environment. */
const servePeerWithRenewal = (
  options: { readonly policy?: ManagedPolicyDocument; readonly env?: Record<string, string> } = {},
) =>
  servePeer(
    box,
    Layer.empty,
    ForkSessionRenewalHttp.routeLayer.pipe(
      Layer.provide(ManagedPolicy.layerTest(options.policy)),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} }))),
    ),
  );

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
      // A cap it cannot read turns renewal off rather than lifting the cap.
      const unreadable = yield* servePeerWithRenewal({
        env: { T3CODE_SESSION_RENEWAL_MAX_AGE_DAYS: "-1" },
      });
      const unreadablePairing = yield* unreadable.auth.exchangeBootstrapCredentialForAccessToken(
        (yield* unreadable.auth.issuePairingCredential()).credential,
        undefined,
        { deviceType: "mobile" },
      );
      yield* TestClock.adjust(Duration.days(2));
      expect(
        (yield* post(unreadable.url, {
          authorization: `Bearer ${unreadablePairing.access_token}`,
        })).status,
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
