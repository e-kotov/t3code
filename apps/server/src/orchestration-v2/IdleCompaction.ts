import { isListedThreadLineage, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { COMPACTION_SUGGESTION_MIN_TOKENS } from "@t3tools/shared/claudeCompaction";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { isIdleThreadProvider, type MachineIdlePolicy } from "@t3tools/shared/threadCachePolicy";
import * as DateTime from "effect/DateTime";
import { isUserIdleTurn, machineIdleWindow } from "./IdleThreadTiming.ts";

// Claude Code's idleCompaction defaults to 200K and won't go below 100K. Below
// that a cold re-read is cheap, so compacting mostly loses context for little
// saving.
const MIN_CONTEXT_TOKENS = COMPACTION_SUGGESTION_MIN_TOKENS;
// Start this long before the cache expires: enough for the session to resume
// and send the compaction while the cache is still warm.
const LEAD_MS = 2 * 60_000;

export type IdleCompactionRecords = Pick<
  OrchestrationV2ThreadProjection,
  | "thread"
  | "runs"
  | "messages"
  | "providerThreads"
  | "providerTurns"
  | "runtimeRequests"
  | "turnItems"
  | "contextTransfers"
>;

/**
 * When an idle Claude thread should compact, or null when it should not. The
 * window ends when the prompt cache of Claude's last request expires (1h on
 * subscriptions, 5m on API keys); compacting after that pays a full uncached
 * read.
 */
export function idleCompactionWindow(
  {
    thread,
    runs,
    messages,
    providerThreads,
    providerTurns,
    runtimeRequests,
    turnItems,
    contextTransfers,
  }: IdleCompactionRecords,
  nowMs: number,
  policy?: MachineIdlePolicy,
): {
  readonly runId: (typeof runs)[number]["id"];
  readonly startMs: number;
  readonly endMs: number;
} | null {
  if (thread.deletedAt !== null || thread.archivedAt !== null) return null;
  if (thread.settledAt !== null || thread.settledOverride === "settled") return null;
  if (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
    return null;
  if (!isListedThreadLineage(thread.lineage)) return null;
  // A removed or steered queued message leaves a cancelled run that never started.
  const latestRun = runs
    .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
    .reduce<(typeof runs)[number] | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );
  if (latestRun?.status !== "completed" || latestRun.completedAt === null) return null;
  const message = messages.find((candidate) => candidate.id === latestRun.userMessageId);
  // Never compact a compaction, so one idle spell compacts at most once.
  if (
    message === undefined ||
    message.text.trim().toLowerCase() === "/compact" ||
    (policy !== undefined && (policy.mode !== "compact" || !isUserIdleTurn(message)))
  )
    return null;
  if (
    runtimeRequests.some((request) => request.status === "pending") ||
    // A pending merge-back belongs to the user's next message.
    contextTransfers.some(
      (transfer) =>
        transfer.type === "merge_back" &&
        transfer.targetThreadId === thread.id &&
        transfer.status === "pending",
    ) ||
    // Background work reports into the next turn; compaction would swallow it. A delegated
    // child's result arrives later as its own message, so it does not count.
    derivePendingBackgroundWork({
      latestRun,
      runs,
      providerThreads,
      turnItems: turnItems.filter(
        (item) => item.type !== "subagent" || item.origin !== "app_owned",
      ),
      activeProviderThreadId: thread.activeProviderThreadId,
    }).length > 0
  )
    return null;
  const providerThread = providerThreads.find(
    (candidate) => candidate.id === thread.activeProviderThreadId,
  );
  const driver: string | undefined = providerThread?.driver;
  // The current selection must still target the session whose context was measured.
  if (
    providerThread === undefined ||
    driver === undefined ||
    !isIdleThreadProvider(driver) ||
    (policy === undefined && driver !== "claudeAgent") ||
    (policy !== undefined &&
      !modelSelectionsEqual(latestRun.modelSelection, thread.modelSelection)) ||
    providerThread.id !== latestRun.providerThreadId ||
    providerThread.providerInstanceId !== thread.providerInstanceId ||
    latestRun.providerInstanceId !== thread.providerInstanceId
  )
    return null;
  const usages = providerTurns
    .filter((turn) => turn.providerThreadId === providerThread.id && turn.tokenUsage !== undefined)
    .map((turn) => turn.tokenUsage!)
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const limits = policy?.[driver];
  if ((usages[0]?.usedTokens ?? 0) < (limits?.minContextTokens ?? MIN_CONTEXT_TOKENS)) return null;
  // A request served fully from cache creates no cache entry and reports no
  // TTL, but it still refreshes the cache. Treat it as unknown and skip.
  const expiresAt = usages[0]?.promptCacheExpiresAt;
  if (limits !== undefined) {
    if (driver === "claudeAgent" && expiresAt === undefined) return null;
    const window = machineIdleWindow(
      latestRun.completedAt,
      limits.idleMinutes,
      expiresAt === undefined ? undefined : Date.parse(expiresAt),
    );
    if (!(window.endMs > Math.max(nowMs, window.startMs))) return null;
    return { runId: latestRun.id, ...window };
  }
  const endMs = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  if (!Number.isFinite(endMs) || nowMs >= endMs) return null;
  return { runId: latestRun.id, startMs: endMs - LEAD_MS, endMs };
}
