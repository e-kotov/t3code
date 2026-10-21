import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { codexProviderTurnTokenUsage } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { makeCodexCacheUsageRecorder } from "./CodexCacheTelemetry.ts";

const at = "2026-10-21T09:00:00.000Z";
const context = {
  startedAt: DateTime.makeUnsafe(at),
  input: { modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" } },
};
function notification(turnId: string, cachedInputTokens: number, totalInput = 20_000, input = 10_000) {
  const last = { inputTokens: input, cachedInputTokens, outputTokens: 100, reasoningOutputTokens: 0, totalTokens: input + 100 };
  return {
    threadId: "native-thread", turnId,
    tokenUsage: { last, total: { ...last, inputTokens: totalInput, totalTokens: totalInput + 100 }, modelContextWindow: 200_000 },
  };
}

describe("Codex first-response cache telemetry", () => {
  it("preserves a cold first response when later tool responses hit the cache", () => {
    const record = makeCodexCacheUsageRecorder(codexProviderTurnTokenUsage);
    const cold = record(notification("turn-1", 0), at, context);
    const warm = record(notification("turn-1", 9_000, 30_000), "2026-10-21T09:01:00.000Z", context);
    expect(warm.cachedInputTokens).toBe(9_000);
    expect(warm.cacheFirstRequest).toEqual(cold.cacheFirstRequest);
    expect(warm.cacheFirstRequest).toMatchObject({ cachedInputTokens: 0, inputTokens: 10_000, reportedAt: at });
    expect(warm.cacheScopeKey).toBe("codex:gpt-6.1-sol");
  });

  it("does not treat unchanged cumulative usage as a response in the next turn", () => {
    const record = makeCodexCacheUsageRecorder(codexProviderTurnTokenUsage);
    record(notification("turn-1", 9_000), at, context);
    expect(record(notification("turn-2", 9_000), at, context).cacheFirstRequest).toBeUndefined();
    expect(record(notification("turn-2", 0, 30_000), at, context).cacheFirstRequest?.cachedInputTokens).toBe(0);
  });

  it("skips empty updates and isolates interleaved native threads", () => {
    const record = makeCodexCacheUsageRecorder(codexProviderTurnTokenUsage);
    expect(record(notification("turn-1", 0, 0, 0), at, context).cacheFirstRequest).toBeUndefined();
    const first = record(notification("turn-1", 5_000), at, context).cacheFirstRequest;
    record({ ...notification("turn-2", 0), threadId: "another-thread" }, at, context);
    expect(record(notification("turn-1", 9_000, 30_000), at, context).cacheFirstRequest).toEqual(first);
  });
});
