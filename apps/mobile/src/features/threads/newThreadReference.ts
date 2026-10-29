import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import type { NewTaskDraftRouteParams } from "./thread-route-state";

export function newThreadDraftRoute(
  thread: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "projectId" | "title" | "branch" | "worktreePath"
  >,
  requestId: string,
): NewTaskDraftRouteParams {
  return {
    requestId,
    environmentId: String(thread.environmentId),
    projectId: String(thread.projectId),
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
}

export function newThreadReferenceRoute(
  thread: Parameters<typeof newThreadDraftRoute>[0],
  requestId: string,
): NewTaskDraftRouteParams {
  return {
    ...newThreadDraftRoute(thread, requestId),
    referenceThread: threadContextRecord(
      scopeThreadRef(thread.environmentId, thread.id),
      thread.title,
    ),
  };
}
