import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { MenuAction } from "@react-native-menu/menu";
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
    const draft =
      event === ACTION
        ? newThreadReferenceRoute(thread, uuidv4())
        : newThreadDraftRoute(thread, uuidv4());
    selectDetail({ name: "Thread", params: { draft } });
    return true;
  };
  return { actions, handleAction };
}
