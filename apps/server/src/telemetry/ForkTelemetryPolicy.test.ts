import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

it.layer(NodeServices.layer)("EK telemetry policy", (it) => {
  it.effect.each([undefined, false, true])("analytics enabled=%s", (enabled) =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const client = HttpClient.make((request) => {
        requests.push(request.url);
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}")));
      });
      const runtime = AnalyticsService.layer.pipe(
        Layer.provide(ManagedPolicy.layerTest()),
        Layer.provideMerge(
          ServerConfig.ServerConfig.layerTest(process.cwd(), {
            prefix: "t3-fork-telemetry-",
          }),
        ),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...(enabled === undefined ? {} : { T3CODE_TELEMETRY_ENABLED: enabled }),
              T3CODE_POSTHOG_HOST: "https://telemetry.example",
            }),
          ),
        ),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Architecture, "x64"),
            Layer.succeed(HttpClient.HttpClient, client),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const analytics = yield* AnalyticsService.AnalyticsService;
        yield* analytics.record("test.fork-policy");
        yield* analytics.flush;
        if (enabled !== true) {
          assert.isFalse(yield* fs.exists(config.anonymousIdPath));
        }
      }).pipe(Effect.provide(runtime));
      assert.deepEqual(requests, enabled === true ? ["https://telemetry.example/batch/"] : []);
    }),
  );
});
