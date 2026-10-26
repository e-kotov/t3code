import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ContextMenuItem } from "@t3tools/contracts";
import type { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useComposerDraftStore } from "../composerDraftStore";
import { threadContextRecord } from "../lib/composerContextRecords";

export type ReferenceThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "title" | "branch" | "worktreePath"
>;
export type StartReferencedThread = ReturnType<typeof useNewThreadHandler>;
export const NEW_THREAD_WITH_REFERENCE = "new-thread-with-reference";

export async function showThreadReferenceContextMenu<T extends string>(
  thread: ReferenceThread,
  items: readonly ContextMenuItem<T>[],
  position: { x: number; y: number } | undefined,
  start: StartReferencedThread,
  show: (
    items: readonly ContextMenuItem<string>[],
    position?: { x: number; y: number },
  ) => Promise<string | null>,
): Promise<T | null> {
  const menu: ContextMenuItem<string>[] = items.flatMap((item) =>
    item.id === "new-thread-on-branch"
      ? [item, {
          id: NEW_THREAD_WITH_REFERENCE,
          label: `New thread on ${thread.branch} with reference`,
          icon: "message-square-plus",
        }]
      : [item],
  );
  const selected = await show(menu, position);
  if (selected !== NEW_THREAD_WITH_REFERENCE) return selected as T | null;
  const opened = await start(scopeProjectRef(thread.environmentId, thread.projectId), {
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    envMode: thread.worktreePath ? "worktree" : "local",
    startFromOrigin: false,
  });
  if (opened) {
    useComposerDraftStore.getState().addThreadContexts(opened.draftId, [
      threadContextRecord(scopeThreadRef(thread.environmentId, thread.id), thread.title),
    ]);
  }
  return null;
}
