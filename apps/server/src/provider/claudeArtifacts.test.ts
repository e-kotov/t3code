import { describe, expect, it } from "@effect/vitest";
import { ClaudeSettings, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeClaudeQueryOptions } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { makePendingClaudeProvider } from "./ClaudeProvider.ts";
import { claudeArtifactQueryKey } from "./claudeArtifacts.ts";

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

const selection = (artifacts?: boolean): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-5-5",
  ...(artifacts === undefined ? {} : { options: [{ id: "artifacts", value: artifacts }] }),
});

describe("Claude Artifacts session option", () => {
  it.effect("advertises Artifacts alongside model options for built-in and custom models", () =>
    Effect.gen(function* () {
      const capabilities = {
        optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" as const }],
      };
      const settings = yield* decodeClaudeSettings({
        customModels: [{ slug: "claude-custom", name: "Custom", capabilities }],
      });
      const provider = yield* makePendingClaudeProvider(settings);
      expect(provider.models.some((model) => !model.isCustom)).toBe(true);
      for (const model of provider.models) {
        expect(model.capabilities?.optionDescriptors?.map((option) => option.id)).toContain(
          "artifacts",
        );
      }
      expect(
        provider.models
          .find((model) => model.slug === "claude-custom")
          ?.capabilities?.optionDescriptors?.map((option) => option.id),
      ).toEqual(["fastMode", "artifacts"]);
      expect(capabilities.optionDescriptors).toHaveLength(1);
    }),
  );

  it("opts only the selected query in and preserves explicit disable settings", () => {
    const environment = { PATH: "/bin", CLAUDE_CODE_DISABLE_ARTIFACT: "1" };
    const sdkSettings = {
      enableArtifact: false,
      env: { KEEP: "value", CLAUDE_CODE_ARTIFACT: "0" },
    };
    const query = (artifacts?: boolean) =>
      makeClaudeQueryOptions({
        modelSelection: selection(artifacts),
        nativeThreadId: "artifact-test",
        resume: false,
        cwd: "/workspace",
        environment,
        sdkSettings,
      });
    const enabled = query(true);
    expect(enabled.env).toMatchObject({
      CLAUDE_CODE_ARTIFACT: "1",
      CLAUDE_CODE_DISABLE_ARTIFACT: "1",
    });
    expect(enabled.settings).toMatchObject({
      enableArtifact: false,
      env: { KEEP: "value", CLAUDE_CODE_ARTIFACT: "1" },
    });
    expect(query(false).env?.CLAUDE_CODE_ARTIFACT).toBe("0");
    expect(query().env).toBe(environment);
    expect(environment).not.toHaveProperty("CLAUDE_CODE_ARTIFACT");
    expect(sdkSettings.env.CLAUDE_CODE_ARTIFACT).toBe("0");
  });

  it("separates process reuse for enabled, disabled and inherited Artifacts", () => {
    const inherited = claudeArtifactQueryKey("policy", selection());
    const enabled = claudeArtifactQueryKey("policy", selection(true));
    const disabled = claudeArtifactQueryKey("policy", selection(false));
    expect(new Set([inherited, enabled, disabled]).size).toBe(3);
    expect(claudeArtifactQueryKey("other-policy", selection(true))).not.toBe(enabled);
    expect(claudeArtifactQueryKey("policy", selection(true))).toBe(enabled);
  });
});
