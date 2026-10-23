import type { OrchestrationV2Command, ServerSettings as Settings } from "@t3tools/contracts";
import { resolveThreadIdleCompaction, threadCachePolicy } from "@t3tools/shared/threadCachePolicy";
import { idleCompactionWindow, type IdleCompactionRecords } from "./IdleCompaction.ts";

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
    return threadCachePolicy(settings, command.threadId) === "warm";
  }
  const window = idleCompactionWindow(projection, nowMs);
  return (
    resolveThreadIdleCompaction(
      settings,
      command.threadId,
      projection.thread.providerInstanceId,
    ) === "beforeCacheExpires" &&
    window !== null &&
    nowMs >= window.startMs &&
    !projection.runs.some((run) => run.status === "queued") &&
    command.commandId === `server:idle-compact:${command.threadId}:${window.runId}`
  );
}

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ServerSettings from "../serverSettings.ts";

class ThreadCachePolicyChanged extends Schema.TaggedError<ThreadCachePolicyChanged>()(
  "ThreadCachePolicyChanged",
  {},
) {}

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
