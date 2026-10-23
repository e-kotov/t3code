import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";

const CLAUDE_TEST_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude-test"),
  model: "claude-sonnet-4-6",
};

describe("fork Claude cache usage", () => {
  it("projects assistant usage against the selected context window", () => {
    const usage = ClaudeAdapterV2.claudeProviderTurnTokenUsage(
      {
        input_tokens: 42_000,
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 5_000,
        output_tokens: 1_000,
      },
      CLAUDE_TEST_MODEL_SELECTION,
      "2026-08-29T00:00:00.000Z",
    );

    assert.deepEqual(usage, {
      cacheScopeKey: `${CLAUDE_TEST_MODEL_SELECTION.instanceId}:${CLAUDE_TEST_MODEL_SELECTION.model}`,
      cacheCreationTokens: 2_000,
      usedTokens: 50_000,
      maxTokens: 200_000,
      inputTokens: 49_000,
      cachedInputTokens: 5_000,
      outputTokens: 1_000,
      reasoningOutputTokens: 0,
      updatedAt: "2026-08-29T00:00:00.000Z",
    });
  });

  it("reports the prompt cache TTL the response wrote", () => {
    const ttlFor = (cache_creation: {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    }) =>
      ClaudeAdapterV2.claudeProviderTurnTokenUsage(
        { input_tokens: 1, output_tokens: 1, cache_creation },
        CLAUDE_TEST_MODEL_SELECTION,
        "2026-08-29T00:00:00.000Z",
      ).promptCacheTtlMs;

    assert.strictEqual(
      ttlFor({ ephemeral_1h_input_tokens: 2_000, ephemeral_5m_input_tokens: 300 }),
      60 * 60_000,
    );
    assert.strictEqual(
      ttlFor({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 300 }),
      5 * 60_000,
    );
    assert.strictEqual(
      ttlFor({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }),
      undefined,
    );
  });

});
