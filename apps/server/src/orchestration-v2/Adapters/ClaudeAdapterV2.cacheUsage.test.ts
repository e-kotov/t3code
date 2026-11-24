import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
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
      200_000,
      "2026-08-29T00:00:00.000Z",
      "",
      undefined,
      undefined,
      CLAUDE_TEST_MODEL_SELECTION,
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

  it("keeps the cache deadline when accounting for only the final main-model sample", () => {
    const usage = ClaudeAdapterV2.claudeProviderTurnTokenUsage(
      {
        input_tokens: 300,
        cache_read_input_tokens: 90_000,
        output_tokens: 40,
        iterations: [
          {
            type: "message",
            cache_creation: null,
            cache_creation_input_tokens: 0,
            input_tokens: 100,
            cache_read_input_tokens: 40_000,
            output_tokens: 10,
          },
          {
            type: "advisor_message",
            cache_creation: null,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 120_000,
            output_tokens: 500,
            model: "claude-opus-4-6",
          },
          {
            type: "message",
            cache_creation: null,
            cache_creation_input_tokens: 0,
            input_tokens: 200,
            cache_read_input_tokens: 50_000,
            output_tokens: 30,
          },
        ],
      },
      200_000,
      "2026-08-29T00:01:00.000Z",
      "",
      DateTime.makeUnsafe("2026-08-29T00:00:00.000Z"),
      5 * 60_000,
      CLAUDE_TEST_MODEL_SELECTION,
    );

    assert.strictEqual(usage.usedTokens, 50_230);
    assert.strictEqual(usage.cachedInputTokens, 50_000);
    assert.strictEqual(usage.promptCacheExpiresAt, "2026-08-29T00:05:00.000Z");
    assert.strictEqual(
      usage.cacheScopeKey,
      `${CLAUDE_TEST_MODEL_SELECTION.instanceId}:${CLAUDE_TEST_MODEL_SELECTION.model}`,
    );
  });

  it("reports the prompt cache TTL the response wrote", () => {
    const ttlFor = (cache_creation: {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    }) =>
      ClaudeAdapterV2.claudeProviderTurnTokenUsage(
        { input_tokens: 1, output_tokens: 1, cache_creation },
        200_000,
        "2026-08-29T00:00:00.000Z",
        "",
        undefined,
        undefined,
        CLAUDE_TEST_MODEL_SELECTION,
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
