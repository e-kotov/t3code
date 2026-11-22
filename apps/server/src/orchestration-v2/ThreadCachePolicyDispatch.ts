import { type OrchestrationV2Command, type ServerSettings as Settings } from "@t3tools/contracts";
import {
  cacheWarmingEnabled,
  isIdleThreadProvider,
  isNeonCacheModel,
  resolveThreadIdleCompaction,
} from "@t3tools/shared/threadCachePolicy";
import { deriveCacheHud } from "@t3tools/shared/cacheHud";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { latestExecutedRun } from "@t3tools/shared/orchestrationV2ThreadError";
import { hasWarmCacheEvidence, isUserIdleTurn, machineWarmWindow } from "./IdleThreadTiming.ts";
import { isActiveRun } from "./CommandPolicy.ts";
import { idleCompactionWindow, type IdleCompactionRecords } from "./IdleCompaction.ts";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ServerSettings from "../serverSettings.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

export function isBackgroundCacheCommand(command: MessageDispatch) {
  return (
    command.creationSource === "server" &&
    (command.commandId.startsWith("command:cache-warm:") ||
      command.commandId.startsWith("server:idle-compact:"))
  );
}

export function backgroundCacheCommandAllowed(
  settings: Settings,
  projection: IdleCompactionRecords,
  command: MessageDispatch,
  nowMs: number,
) {
  if (command.commandId.startsWith("command:cache-warm:")) {
    if (!cacheWarmingEnabled(settings, command.threadId)) return false;
    const policy = settings.machineIdlePolicy;
    const machineCommand = command.commandId.startsWith("command:cache-warm:machine:");
    if (policy === undefined) return !machineCommand;
    const latest = latestExecutedRun(projection.runs);
    const provider = projection.providerThreads.find(
      (entry) => entry.id === projection.thread.activeProviderThreadId,
    );
    const driver: string | undefined = provider?.driver;
    if (
      !machineCommand ||
      latest?.status !== "completed" ||
      latest.completedAt === null ||
      provider === undefined ||
      driver === undefined ||
      !isIdleThreadProvider(driver) ||
      projection.thread.settledAt !== null ||
      !modelSelectionsEqual(latest.modelSelection, projection.thread.modelSelection) ||
      latest.providerThreadId !== provider.id ||
      provider.providerInstanceId !== projection.thread.providerInstanceId ||
      (driver === "antigravity" && !isNeonCacheModel(projection.thread.modelSelection.model)) ||
      !projection.messages.some(
        (message) => message.id === latest.userMessageId && isUserIdleTurn(message),
      ) ||
      settings.cacheWarmingLastWindows[command.threadId] === latest.id ||
      !command.commandId.startsWith(`command:cache-warm:machine:${command.threadId}:${latest.id}:`)
    )
      return false;
    const hud = deriveCacheHud(
      provider.driver,
      projection.providerTurns.flatMap((turn) =>
        turn.providerThreadId === provider.id && turn.tokenUsage !== undefined
          ? [turn.tokenUsage]
          : [],
      ),
      projection.thread.modelSelection,
    );
    if (hud === null || !hasWarmCacheEvidence(hud)) return false;
    const window = machineWarmWindow(latest.completedAt, policy[driver].idleMinutes, hud);
    return window !== null && nowMs >= window.startMs && nowMs < window.endMs;
  }
  const window = idleCompactionWindow(projection, nowMs, settings.machineIdlePolicy);
  return (
    resolveThreadIdleCompaction(
      settings,
      command.threadId,
      projection.thread.providerInstanceId,
    ) === "beforeCacheExpires" &&
    window !== null &&
    nowMs >= window.startMs &&
    !projection.runs.some((run) => run.status === "queued" || isActiveRun(run)) &&
    command.commandId === `server:idle-compact:${command.threadId}:${window.runId}`
  );
}

class ThreadCachePolicyChanged extends Schema.TaggedError<ThreadCachePolicyChanged>()(
  "ThreadCachePolicyChanged",
  {},
) {}

const isThreadCachePolicyChanged = Schema.is(ThreadCachePolicyChanged);

/** A settings change can make the same idle window eligible again. */
export function retryableCachePolicyRejection(cause: {
  readonly _tag: string;
  readonly cause?: unknown;
}) {
  return cause._tag === "OrchestratorDispatchError" && isThreadCachePolicyChanged(cause.cause);
}

export const checkBackgroundCachePolicy = Effect.fn("ThreadCachePolicyDispatch.check")(function* (
  command: MessageDispatch,
  projection: IdleCompactionRecords,
) {
  if (!isBackgroundCacheCommand(command)) return;
  const settings = yield* ServerSettings.ServerSettingsService;
  const current = yield* settings.getSettings;
  if (
    !backgroundCacheCommandAllowed(
      current,
      projection,
      command,
      DateTime.toEpochMillis(yield* DateTime.now),
    )
  ) {
    return yield* new ThreadCachePolicyChanged();
  }
});
