import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { MenuAction } from "@react-native-menu/menu";
import { uuidv4 } from "../../lib/uuid";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { newThreadReferenceRoute } from "./newThreadReference";

const ACTION = "new-thread-with-reference";

export function useNewThreadReferenceMenu(thread: EnvironmentThreadShell) {
  const selectDetail = useSelectWorkspaceDetail();
  const actions: MenuAction[] = thread.branch ? [{
    id: ACTION,
    title: `New thread on ${thread.branch} with reference`,
    image: "square.and.pencil",
  }] : [];
  const handleAction = (event: string) => {
    if (event !== ACTION) return false;
    selectDetail({ name: "Thread", params: { draft: newThreadReferenceRoute(thread, uuidv4()) } });
    return true;
  };
  return { actions, handleAction };
}
