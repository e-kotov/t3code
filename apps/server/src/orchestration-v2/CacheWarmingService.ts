import { CommandId, MessageId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { threadCachePolicy } from "@t3tools/shared/threadCachePolicy";
import { presentCacheHud } from "@t3tools/shared/cacheHud";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import * as ServerSettings from "../serverSettings.ts";
import { cacheWarmingRetired } from "./CacheWarmingDispatchGuard.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const CODEX_WARM_MARGIN_MS = 5 * 60_000;
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
    | "modelSelection"
    | "activeProviderThreadId"
  >;
  readonly nowMs: number;
  readonly enabled: boolean;
  readonly alreadyWarmedWindow?: string;
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
    (hud.driver !== "codex" && hud.driver !== "claudeAgent") ||
    hud.ttlMs === undefined ||
    ((hud.usage.cachedInputTokens ?? 0) <= 0 && (hud.usage.cacheCreationTokens ?? 0) <= 0)
  ) {
    return null;
  }

  const view = presentCacheHud(hud, input.nowMs);
  if (view.remainingMs === null || view.remainingMs <= 0) return null;
  const marginMs = hud.driver === "codex" ? CODEX_WARM_MARGIN_MS : CLAUDE_WARM_MARGIN_MS;
  if (view.remainingMs > marginMs) return null;

  const lastUserMessageAt = thread.latestUserAuthoredMessageAt;
  if (lastUserMessageAt == null) return null;
  const fingerprint = [
    DateTime.toEpochMillis(lastUserMessageAt),
    Date.parse(hud.usage.updatedAt),
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

  // The previous UI had a master pause that preserved per-thread opt-ins.
  // Convert a paused legacy configuration to explicit off choices once before
  // the new all-conversations control starts using those choices directly.
  const initialSettings = yield* settingsService.getSettings;
  if (!initialSettings.cacheWarmingInitialized) {
    yield* settingsService.updateSettings({
      cacheWarmingInitialized: true,
      ...(!initialSettings.cacheWarmingEnabled
        ? {
            cacheWarmingSessions: Object.fromEntries(
              Object.keys(initialSettings.cacheWarmingSessions).map((threadId) => [
                threadId,
                false,
              ]),
            ),
          }
        : {}),
    });
  }

  const sweep = Effect.gen(function* () {
    const snapshot = yield* threads.getShellSnapshot();
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    for (const thread of snapshot.threads) {
      const latestSettings = yield* settingsService.getSettings;
      const enabled = threadCachePolicy(latestSettings, thread.id) === "warm";
      if (!enabled) continue;
      if (cacheWarmingRetired(thread, now)) {
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
        ...(latestSettings.cacheWarmingLastWindows[thread.id] === undefined
          ? {}
          : { alreadyWarmedWindow: latestSettings.cacheWarmingLastWindows[thread.id] }),
      });
      if (window === null) continue;

      const submissionSettings = yield* settingsService.getSettings;
      if (threadCachePolicy(submissionSettings, thread.id) !== "warm") continue;
      if (submissionSettings.cacheWarmingLastWindows[thread.id] === window.fingerprint) continue;

      // Give a rejected idle-only attempt a fresh receipt key on the next sweep.
      // Successful attempts are deduped persistently by the window marker below.
      const key = `${thread.id}:${window.fingerprint}:${now}`;
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
