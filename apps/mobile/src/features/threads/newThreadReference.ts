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
  scratch = false,
): NewTaskDraftRouteParams {
  return {
    requestId,
    environmentId: String(thread.environmentId),
    projectId: String(thread.projectId),
    branch: scratch ? null : thread.branch,
    worktreePath: scratch ? null : thread.worktreePath,
  };
}

export function newThreadReferenceRoute(
  thread: Parameters<typeof newThreadDraftRoute>[0],
  requestId: string,
  scratch = false,
): NewTaskDraftRouteParams {
  return {
    ...newThreadDraftRoute(thread, requestId, scratch),
    referenceThread: threadContextRecord(
      scopeThreadRef(thread.environmentId, thread.id),
      thread.title,
    ),
  };
}
