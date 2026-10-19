import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { createBuildConfig, resolveGitHubPublishConfig } from "./build-desktop-artifact.ts";

it.layer(NodeServices.layer)("EK desktop update policy", (it) => {
  it.effect("omits native update feeds for Homebrew ownership", () =>
    Effect.gen(function* () {
      assert.isUndefined(yield* resolveGitHubPublishConfig("latest"));
      assert.isUndefined(yield* resolveGitHubPublishConfig("nightly"));
      const config = yield* createBuildConfig(
        "mac",
        "dmg",
        "0.0.46-ek.8",
        false,
        false,
        undefined,
        undefined,
      );
      // Upstream pins `publish: null` so electron-builder cannot infer a GitHub feed.
      assert.isNull(config.publish);
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            GITHUB_REPOSITORY: "e-kotov/t3code",
          }),
        ),
      ),
    ),
  );
});
