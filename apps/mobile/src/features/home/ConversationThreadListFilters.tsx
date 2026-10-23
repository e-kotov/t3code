import type { ComponentProps } from "react";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import { ThreadListFilters } from "./ThreadListFilters";
import {
  applyConversationListMenuEvent,
  conversationChoiceActions,
  type ConversationListControls,
} from "./conversationListOptions";

export function ConversationThreadListFilters({
  conversationList,
  ...props
}: ComponentProps<typeof ThreadListFilters> & {
  readonly conversationList: ConversationListControls;
}) {
  return (
    <ThreadListFilters {...props}>
      {(["sort", "grouping"] as const).map((kind) => {
        const actions = conversationChoiceActions(kind, conversationList, undefined);
        return (
          <ListFilterMenu
            key={kind}
            label={actions.find((action) => action.state === "on")?.title ?? kind}
            accessibilityLabel={kind === "sort" ? "Sort conversations" : "Group conversations"}
            active={kind === "sort" ? conversationList.conversationSortOrder !== "updated_at" : conversationList.conversationGrouping !== "none"}
            actions={actions}
            onSelect={(id) => { applyConversationListMenuEvent(id, conversationList); }}
          />
        );
      })}
    </ThreadListFilters>
  );
}
