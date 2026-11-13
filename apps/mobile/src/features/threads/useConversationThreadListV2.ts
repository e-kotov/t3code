import { arrangeWorkingSidebarList } from "./workingSidebarList";
import { useThreadListV2 } from "./useThreadListV2";
import { arrangeMobileConversationList } from "./machineGroupedThreadList";
import type { ConversationShelfSortInput } from "./conversationListOrder";

import { useMachineGroupCollapse } from "./machineGroupCollapse";

export function useConversationThreadListV2(
  input: Parameters<typeof useThreadListV2>[0] & {
    readonly conversation: Omit<Parameters<typeof arrangeMobileConversationList>[1], "grouping"> & {
      readonly view: ConversationShelfSortInput;
    };
  },
) {
  const { conversation, ...listInput } = input;
  const { collapsedMachineGroups } = useMachineGroupCollapse();
  const workingOnly = conversation.view.workingOnly === true;
  const result = useThreadListV2({
    ...listInput,
    pendingTasks: workingOnly ? [] : listInput.pendingTasks,
    workingOnly,
    conversationSortOrder: conversation.view.conversationSortOrder,
    conversationGrouping: conversation.view.conversationGrouping,
  });
  return {
    ...result,
    items: arrangeMobileConversationList(
      arrangeWorkingSidebarList(
        result.items,
        conversation.view.workingFirst === true && !input.searchQuery.trim(),
      ),
      {
        ...conversation,
        collapsedMachineGroups,
        selectedThreadKey: input.selectedThreadKey,
        searchQuery: input.searchQuery,
        grouping: conversation.view.conversationGrouping ?? "none",
      },
    ),
  };
}
