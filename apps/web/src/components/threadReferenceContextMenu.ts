import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ContextMenuItem } from "@t3tools/contracts";
import type { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  readEnvironmentServerConfigLoaded,
  readProject,
} from "../state/entities";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";

export type ReferenceThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "title" | "branch" | "worktreePath"
>;
export type StartReferencedThread = ReturnType<typeof useNewThreadHandler>;
const NEW_THREAD_IN_PROJECT = "new-thread-in-project";
const NEW_THREAD_WITH_REFERENCE = "new-thread-with-reference";

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
  const referenceItem: ContextMenuItem<string> = {
    id: NEW_THREAD_WITH_REFERENCE,
    label: thread.branch
      ? `New thread on ${thread.branch} with reference`
      : "New thread with reference",
    icon: "message-square-plus",
  };
  const menu: ContextMenuItem<string>[] = thread.branch
    ? items.flatMap((item) => (item.id === "new-thread-on-branch" ? [item, referenceItem] : [item]))
    : [
        { id: NEW_THREAD_IN_PROJECT, label: "New thread", icon: "message-square-plus" },
        referenceItem,
        ...items,
      ];
  const selected = await show(menu, position);
  if (selected !== NEW_THREAD_WITH_REFERENCE && selected !== NEW_THREAD_IN_PROJECT)
    return selected as T | null;
  const projectRef = scopeProjectRef(thread.environmentId, thread.projectId);
  const project = readProject(projectRef);
  if (
    !thread.branch &&
    thread.worktreePath &&
    (!project || !readEnvironmentServerConfigLoaded(thread.environmentId))
  ) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not create thread",
        description: "Wait for this machine's project details to load, then try again.",
      }),
    );
    return null;
  }
  const scratch = project?.isScratch === true;
  const worktreePath = scratch ? null : thread.worktreePath;
  const opened = await start(projectRef, {
    branch: scratch ? null : thread.branch,
    worktreePath,
    envMode: worktreePath ? "worktree" : "local",
    startFromOrigin: false,
  }).catch((error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not create thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
    return null;
  });
  if (opened && selected === NEW_THREAD_WITH_REFERENCE) {
    useComposerDraftStore
      .getState()
      .addThreadContexts(opened.draftId, [
        threadContextRecord(scopeThreadRef(thread.environmentId, thread.id), thread.title),
      ]);
  }
  return null;
}
