import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadShell,
  type RunId,
} from "@t3tools/contracts";
import {
  isNeonCacheModel,
  cacheWarmingEnabled,
  isIdleThreadProvider,
  type MachineIdlePolicy,
  legacyCacheWarmingMigration,
} from "@t3tools/shared/threadCachePolicy";
import {
  CODEX_WARM_MARGIN_MS,
  NEON_WARM_MARGIN_MS,
  cacheWarmWindowMs,
  presentCacheHud,
} from "@t3tools/shared/cacheHud";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as ServerSettings from "../serverSettings.ts";
import { cacheWarmingRetired } from "./CacheWarmingDispatchGuard.ts";
import { hasWarmCacheEvidence, isUserIdleTurn, machineWarmWindow } from "./IdleThreadTiming.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const CLAUDE_WARM_MARGIN_MS = 60_000;
const CHECK_INTERVAL = "30 seconds";
const WARM_PROMPT =
  "Cache warm check only: do not use tools or inspect or change anything. Reply with exactly: cache warm.";

export interface CacheWarmingCandidate {
  readonly thread: Pick<
    OrchestrationV2ThreadShell,
    | "lineage"
    | "archivedAt"
    | "settledOverride"
    | "snoozedUntil"
    | "activeRunId"
    | "pendingRuntimeRequest"
    | "pendingBackgroundTasks"
    | "lastError"
    | "lastErrorClass"
    | "usageLimitResetAt"
    | "limitRecovery"
    | "status"
    | "cacheHud"
    | "latestUserAuthoredMessageAt"
    | "latestRunCompletedAt"
    | "modelSelection"
    | "activeProviderThreadId"
  > &
    Partial<Pick<OrchestrationV2ThreadShell, "latestRunId">>;
  readonly nowMs: number;
  readonly enabled: boolean;
  readonly codexWarmAfterMinutes: number;
  readonly neonWarmAfterMinutes?: number;
  readonly alreadyWarmedWindow?: string;
  readonly policy?: MachineIdlePolicy;
}

export interface CacheWarmingWindow {
  readonly fingerprint: string;
  readonly marginMs: number;
}

/** Only fresh, supported cache windows on idle root threads can be warmed. */
export function cacheWarmingWindow(input: CacheWarmingCandidate): CacheWarmingWindow | null {
  const { thread } = input;
  if (!input.enabled || thread.lineage.relationshipToParent === "subagent") return null;
  if (
    thread.archivedAt !== null ||
    cacheWarmingRetired(thread, input.nowMs) ||
    thread.activeRunId !== null ||
    thread.pendingRuntimeRequest !== null ||
    (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
    thread.lastError != null ||
    thread.lastErrorClass != null ||
    thread.usageLimitResetAt != null ||
    thread.limitRecovery != null ||
    (thread.status !== "idle" && thread.status !== "completed")
  ) {
    return null;
  }

  const hud = thread.cacheHud;
  if (
    hud == null ||
    (input.policy === undefined && hud.ttlMs === undefined) ||
    !hasWarmCacheEvidence(hud)
  ) {
    return null;
  }

  const driver: string = hud.driver;
  const neon = driver === "antigravity";
  if (neon && !isNeonCacheModel(thread.modelSelection.model)) return null;
  if (input.policy !== undefined) {
    if (
      input.policy.mode !== "warm" ||
      !isIdleThreadProvider(driver) ||
      thread.latestRunId == null ||
      thread.latestRunCompletedAt == null ||
      thread.latestUserAuthoredMessageAt == null
    )
      return null;
    const window = machineWarmWindow(
      thread.latestRunCompletedAt,
      input.policy[driver].idleMinutes,
      hud,
    );
    if (window === null) return null;
    const { startMs, endMs } = window;
    if (!(input.nowMs >= startMs && input.nowMs < endMs)) return null;
    const fingerprint = thread.latestRunId;
    if (input.alreadyWarmedWindow === fingerprint) return null;
    return { fingerprint, marginMs: endMs - startMs };
  }
  const windowMs = cacheWarmWindowMs(hud, input.codexWarmAfterMinutes, input.neonWarmAfterMinutes);
  if (windowMs === undefined) return null;
  const view = presentCacheHud({ ...hud, ttlMs: windowMs }, input.nowMs);
  if (view.remainingMs === null || view.remainingMs <= 0) return null;
  const marginMs = neon
    ? NEON_WARM_MARGIN_MS
    : hud.driver === "codex"
      ? CODEX_WARM_MARGIN_MS
      : CLAUDE_WARM_MARGIN_MS;
  if (view.remainingMs > marginMs) return null;

  const lastUserMessageAt = thread.latestUserAuthoredMessageAt;
  if (lastUserMessageAt == null) return null;
  const fingerprint = [
    DateTime.toEpochMillis(lastUserMessageAt),
    // One Neon warm turn per user turn, even if the synthetic reply refreshes the cache.
    neon ? "neon" : Date.parse(hud.usage.updatedAt),
    hud.usage.cacheScopeKey ?? "",
    thread.activeProviderThreadId ?? "",
  ].join("|");
  if (input.alreadyWarmedWindow === fingerprint) return null;
  return { fingerprint, marginMs };
}

class CacheWarmingService extends Context.Service<
  CacheWarmingService,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/orchestration-v2/CacheWarmingService") {}

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const migration = legacyCacheWarmingMigration(yield* settingsService.getSettings);
  if (migration !== null) yield* settingsService.updateSettings(migration);

  let rejectedNonUserRuns = new Set<RunId>();
  const sweep = Effect.gen(function* () {
    const previousNonUserRuns = rejectedNonUserRuns;
    rejectedNonUserRuns = new Set<RunId>();
    const snapshot = yield* threads.getShellSnapshot();
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    for (const thread of snapshot.threads) {
      const latestSettings = yield* settingsService.getSettings;
      const enabled = cacheWarmingEnabled(latestSettings, thread.id);
      if (!enabled) continue;
      if (cacheWarmingRetired(thread, now)) {
        if (latestSettings.machineIdlePolicy !== undefined) continue;
        yield* settingsService
          .updateSettings({ cacheWarmingSessions: { [thread.id]: false } })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Retiring cache warming failed", { threadId: thread.id, cause }),
            ),
          );
        continue;
      }
      const window = cacheWarmingWindow({
        thread,
        nowMs: now,
        enabled,
        codexWarmAfterMinutes: latestSettings.codexCacheWarmAfterMinutes,
        neonWarmAfterMinutes: latestSettings.neonCacheWarmAfterMinutes,
        ...(latestSettings.machineIdlePolicy === undefined
          ? {}
          : { policy: latestSettings.machineIdlePolicy }),
        ...(latestSettings.cacheWarmingLastWindows[thread.id] === undefined
          ? {}
          : { alreadyWarmedWindow: latestSettings.cacheWarmingLastWindows[thread.id] }),
      });
      if (window === null) continue;
      if (latestSettings.machineIdlePolicy !== undefined && thread.latestRunId !== null) {
        const runId = thread.latestRunId;
        if (previousNonUserRuns.has(runId)) {
          rejectedNonUserRuns.add(runId);
          continue;
        }
        const records = yield* projections
          .getThreadRecords(thread.id, ["runs", "messages"], {
            runIds: [runId],
            messageRunIds: [runId],
            messageRoles: ["user"],
          })
          .pipe(
            Effect.catchTags({
              ProjectionStoreThreadNotFoundError: () => Effect.succeed(null),
            }),
          );
        if (records === null) continue;
        const promptId = records.runs[0]?.userMessageId;
        const prompt = records.messages.find((message) => message.id === promptId);
        if (prompt === undefined || !isUserIdleTurn(prompt)) {
          if (prompt !== undefined) rejectedNonUserRuns.add(runId);
          continue;
        }
      }

      const submissionSettings = yield* settingsService.getSettings;
      if (!cacheWarmingEnabled(submissionSettings, thread.id)) continue;
      if (submissionSettings.cacheWarmingLastWindows[thread.id] === window.fingerprint) continue;

      // Give a rejected idle-only attempt a fresh receipt key on the next sweep.
      // Successful attempts are deduped persistently by the window marker below.
      const machinePolicy = latestSettings.machineIdlePolicy !== undefined;
      const key = machinePolicy
        ? `machine:${thread.id}:${window.fingerprint}:${now}`
        : `${thread.id}:${window.fingerprint}:${now}`;
      const commandId = CommandId.make(`command:cache-warm:${key}`);
      const messageId = MessageId.make(`message:cache-warm:${key}`);
      yield* threads
        .sendToThread({
          projectId: thread.projectId,
          threadId: thread.id,
          commandId,
          messageId,
          text: WARM_PROMPT,
          attachments: [],
          mode: "idle-only",
          modelSelection: thread.modelSelection,
          expectedActiveProviderThreadId: thread.activeProviderThreadId,
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.flatMap(() =>
            settingsService.updateSettings({
              cacheWarmingLastWindows: { [thread.id]: window.fingerprint },
            }),
          ),
          Effect.catch((cause) =>
            Effect.logDebug("Cache warm turn was skipped", {
              threadId: thread.id,
              cause,
            }),
          ),
        );
    }
  }).pipe(Effect.catch((cause) => Effect.logWarning("Cache warmer sweep failed", { cause })));

  const start: CacheWarmingService["Service"]["start"] = () =>
    Effect.forkScoped(
      sweep.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL)), Effect.asVoid),
    ).pipe(Effect.asVoid);
  return { start } satisfies CacheWarmingService["Service"];
});
