import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  EnvironmentHttpApi,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  type AuthEnvironmentScope,
  ForkThreadQuota as QuotaReading,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { HttpRouter, HttpPlatform, Etag } from "effect/http";
import * as Quota from "./ForkThreadQuota.ts";
import * as Routes from "./forkThreadQuotaHttp.ts";

class QuotaTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.threadQuota) {}
const decodeReading = Schema.decodeUnknownEffect(QuotaReading);

it.effect("requires the read grant before querying quota and safely encodes thread ids", () =>
  Effect.gen(function* () {
    let allowed = false;
    const queried: string[] = [];
    const routes = HttpApiBuilder.layer(QuotaTestApi).pipe(
      Layer.provide(Routes.layer),
      Layer.provide(
        Layer.succeed(Quota.ForkThreadQuota, {
          read: (id) =>
            Effect.sync(() => {
              queried.push(id);
              return {
                status: "available" as const,
                checkedAt: "2026-10-31T12:00:00Z",
                dataAsOf: null,
                fiveHourPercent: 0,
                weeklyPercent: 150.25,
                balanceCredits: null,
              };
            }),
        }),
      ),
      Layer.provide(
        Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
          Effect.suspend(() =>
            effect.pipe(
              Effect.provideService(EnvironmentAuthenticatedPrincipal, {
                sessionId: AuthSessionId.make("test"),
                subject: "test",
                method: "bearer-access-token",
                scopes: new Set<AuthEnvironmentScope>(allowed ? ["orchestration:read"] : []),
              }),
            ),
          ),
        ),
      ),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(Etag.layerWeak),
      Layer.provide(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const request = () => new Request("http://localhost/api/fork/thread-quota/mcp%3Athread");
    const denied = yield* Effect.promise(() => handler(request()));
    assert.equal(denied.status, 403);
    assert.deepEqual(queried, []);
    allowed = true;
    const response = yield* Effect.promise(() => handler(request()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(queried, ["mcp:thread"]);
    const data = yield* Effect.promise(() => response.json()).pipe(Effect.flatMap(decodeReading));
    assert.equal(data.weeklyPercent, 150.25);
  }).pipe(Effect.scoped),
);
