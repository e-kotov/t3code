import type { ModelSelection, OrchestrationV2ProviderTurnTokenUsage } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as DateTime from "effect/DateTime";

type Notification = CodexSchema.V2ThreadTokenUsageUpdatedNotification;
type FirstRequest = NonNullable<OrchestrationV2ProviderTurnTokenUsage["cacheFirstRequest"]>;

/** Later tool responses must not replace the cache result of the request that resumed a turn. */
export function makeCodexCacheUsageRecorder(
  reportUsage: (
    usage: Notification["tokenUsage"],
    updatedAt: string,
    selection: ModelSelection,
  ) => OrchestrationV2ProviderTurnTokenUsage,
) {
  const threads = new Map<string, { turnId: string; total: string; first?: FirstRequest }>();
  return (
    payload: Notification,
    reportedAt: string,
    context: {
      readonly startedAt: DateTime.Utc;
      readonly input: { readonly modelSelection: ModelSelection };
    },
  ): OrchestrationV2ProviderTurnTokenUsage => {
    const usage = reportUsage(payload.tokenUsage, reportedAt, context.input.modelSelection);
    const previous = threads.get(payload.threadId);
    const total = JSON.stringify(payload.tokenUsage.total);
    const first = previous?.turnId === payload.turnId ? previous.first : undefined;
    const inputTokens = usage.inputTokens ?? 0;
    const sample =
      first ??
      (total !== previous?.total && inputTokens > 0 && usage.cachedInputTokens !== undefined
        ? {
            startedAt: DateTime.formatIso(context.startedAt),
            reportedAt,
            inputTokens,
            cachedInputTokens: Math.min(inputTokens, usage.cachedInputTokens),
          }
        : undefined);
    threads.delete(payload.threadId);
    threads.set(payload.threadId, {
      turnId: payload.turnId,
      total,
      ...(sample ? { first: sample } : {}),
    });
    // A session can visit many native threads; only active/recent telemetry belongs in memory.
    if (threads.size > 128) threads.delete(threads.keys().next().value!);
    return { ...usage, ...(sample ? { cacheFirstRequest: sample } : {}) };
  };
}
