import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { MenuAction } from "@react-native-menu/menu";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import { uuidv4 } from "../../lib/uuid";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { newThreadDraftRoute, newThreadReferenceRoute } from "./newThreadReference";

const NEW_THREAD_IN_PROJECT = "new-thread-in-project";
const ACTION = "new-thread-with-reference";

export function useNewThreadReferenceMenu(thread: EnvironmentThreadShell) {
  const selectDetail = useSelectWorkspaceDetail();
  const actions: MenuAction[] = [
    ...(!thread.branch
      ? [{ id: NEW_THREAD_IN_PROJECT, title: "New thread", image: "square.and.pencil" }]
      : []),
    {
      id: ACTION,
      title: thread.branch
        ? `New thread on ${thread.branch} with reference`
        : "New thread with reference",
      image: "square.and.pencil",
    },
  ];
  const handleAction = (event: string) => {
    if (event !== ACTION && event !== NEW_THREAD_IN_PROJECT) return false;
    const scratch =
      thread.worktreePath !== null &&
      appAtomRegistry.get(
        environmentProjects.projectAtom(scopeProjectRef(thread.environmentId, thread.projectId)),
      )?.isScratch === true;
    const draft =
      event === ACTION
        ? newThreadReferenceRoute(thread, uuidv4(), scratch)
        : newThreadDraftRoute(thread, uuidv4(), scratch);
    selectDetail({ name: "Thread", params: { draft } });
    return true;
  };
  return { actions, handleAction };
}
