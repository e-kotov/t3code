import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadComposerContext } from "../../lib/composerContext";
import type { NewTaskDraftRouteParams } from "./thread-route-state";

export function newThreadReferenceRoute(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId" | "title" | "branch" | "worktreePath">,
  requestId: string,
): NewTaskDraftRouteParams {
  return {
    requestId,
    environmentId: String(thread.environmentId),
    projectId: String(thread.projectId),
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    referenceThread: threadComposerContext(scopeThreadRef(thread.environmentId, thread.id), thread.title),
  };
}
