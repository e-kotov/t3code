import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import {
  createBuildConfig,
  resolveGitHubPublishConfig,
  resolveMacPasskeySigningConfiguration,
  renderMacPasskeyEntitlements,
} from "./build-desktop-artifact.ts";
import { FORK_DESKTOP_APP_ID } from "./forkDesktopIdentity.ts";

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
        false,
        "arm64",
        FORK_DESKTOP_APP_ID,
      );
      // Upstream pins `publish: null` so electron-builder cannot infer a GitHub feed.
      assert.isNull(config.publish);
      assert.equal(config.appId, "pro.ekotov.t3code");
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

it("uses the fork identity consistently for passkey signing and entitlements", () => {
  const configuration = resolveMacPasskeySigningConfiguration(
    {
      T3CODE_APPLE_TEAM_ID: "ABC1234567",
      T3CODE_MACOS_PROVISIONING_PROFILE: "/tmp/t3code.provisionprofile",
      T3CODE_CLERK_PASSKEY_RP_DOMAINS: "clerk.example.com",
    },
    FORK_DESKTOP_APP_ID,
  );
  assert.equal(configuration.appId, "pro.ekotov.t3code");
  const entitlements = renderMacPasskeyEntitlements(configuration, {
    touchIdKeychainAccessGroup: undefined,
    browserPasskeys: false,
  });
  assert.include(entitlements, "<string>ABC1234567.pro.ekotov.t3code</string>");
});
