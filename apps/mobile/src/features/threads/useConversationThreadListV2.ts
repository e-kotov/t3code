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
  const result = useThreadListV2({
    ...listInput,
    conversationSortOrder: conversation.view.conversationSortOrder,
    conversationGrouping: conversation.view.conversationGrouping,
  });
  return {
    ...result,
    items: arrangeMobileConversationList(result.items, {
      ...conversation,
      collapsedMachineGroups,
      selectedThreadKey: input.selectedThreadKey,
      searchQuery: input.searchQuery,
      grouping: conversation.view.conversationGrouping ?? "none",
    }),
  };
}
