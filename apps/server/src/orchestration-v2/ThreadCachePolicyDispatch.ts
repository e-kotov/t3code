import type { OrchestrationV2Command, ServerSettings } from "@t3tools/contracts";
import { resolveThreadIdleCompaction, threadCachePolicy } from "@t3tools/shared/threadCachePolicy";
import { idleCompactionWindow, type IdleCompactionRecords } from "./IdleCompaction.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

export function isBackgroundCacheCommand(command: MessageDispatch) {
  return command.creationSource === "server" && (
    command.commandId.startsWith("command:cache-warm:") ||
    command.commandId.startsWith("server:idle-compact:")
  );
}

export function backgroundCacheCommandAllowed(settings: ServerSettings, projection: IdleCompactionRecords, command: MessageDispatch, nowMs: number) {
  if (command.commandId.startsWith("command:cache-warm:")) {
    return threadCachePolicy(settings, command.threadId) === "warm";
  }
  const window = idleCompactionWindow(projection, nowMs);
  return resolveThreadIdleCompaction(settings, command.threadId, projection.thread.providerInstanceId) === "beforeCacheExpires" &&
    window !== null && nowMs >= window.startMs &&
    !projection.runs.some((run) => run.status === "queued") &&
    command.commandId === `server:idle-compact:${command.threadId}:${window.runId}`;
}
