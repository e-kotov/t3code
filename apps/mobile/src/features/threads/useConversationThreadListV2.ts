import { useThreadListV2 } from "./useThreadListV2";
import { arrangeMobileConversationList } from "./machineGroupedThreadList";
import type { ConversationShelfSortInput } from "./conversationListOrder";

export function useConversationThreadListV2(
  input: Parameters<typeof useThreadListV2>[0] & {
    readonly conversation: Omit<Parameters<typeof arrangeMobileConversationList>[1], "grouping"> & {
      readonly view: ConversationShelfSortInput;
    };
  },
) {
  const { conversation, ...listInput } = input;
  const result = useThreadListV2({
    ...listInput,
    conversationSortOrder: conversation.view.conversationSortOrder,
    conversationGrouping: conversation.view.conversationGrouping,
  });
  return { ...result, items: arrangeMobileConversationList(result.items, {
    ...conversation, grouping: conversation.view.conversationGrouping ?? "none",
  }) };
}
