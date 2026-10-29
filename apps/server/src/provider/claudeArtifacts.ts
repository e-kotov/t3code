import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ModelSelection } from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";
import { providerModelsFromSettings } from "@t3tools/provider-core/server/snapshotProbe";

export function claudeArtifactModels(...args: Parameters<typeof providerModelsFromSettings>) {
  return providerModelsFromSettings(...args).map((model) => {
    const descriptors = model.capabilities?.optionDescriptors ?? [];
    if (descriptors.some((option) => option.id === "artifacts")) return model;
    return {
      ...model,
      capabilities: {
        ...model.capabilities,
        optionDescriptors: [
          ...descriptors,
          {
            id: "artifacts",
            label: "Claude Artifacts (experimental)",
            description: "Publish Claude artifacts to claude.ai when your account allows it.",
            type: "boolean" as const,
          },
        ],
      },
    };
  });
}

export function claudeArtifactQueryKey(key: string, selection: ModelSelection): string {
  const artifacts = getModelSelectionBooleanOptionValue(selection, "artifacts");
  return artifacts === undefined ? key : JSON.stringify({ key, artifacts });
}

export function withClaudeArtifactOptions<T extends Pick<Options, "env" | "settings">>(
  selection: ModelSelection,
  options: T,
): T {
  const artifacts = getModelSelectionBooleanOptionValue(selection, "artifacts");
  if (artifacts === undefined) return options;
  // Claude 2.1.312 gates SDK Artifacts on this flag; enableArtifact alone does not opt in.
  const env = { CLAUDE_CODE_ARTIFACT: artifacts ? "1" : "0" };
  return {
    ...options,
    env: { ...options.env, ...env },
    ...(typeof options.settings === "string"
      ? {}
      : { settings: { ...options.settings, env: { ...options.settings?.env, ...env } } }),
  };
}
