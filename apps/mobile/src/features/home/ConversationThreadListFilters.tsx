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
  machineSummary,
  ...props
}: ComponentProps<typeof ThreadListFilters> & {
  readonly conversationList: ConversationListControls;
  readonly machineSummary?: string;
}) {
  return (
    <ThreadListFilters {...props}>
      {(["sort", "grouping"] as const).map((kind) => {
        const actions = conversationChoiceActions(
          kind,
          conversationList,
          undefined,
          machineSummary,
        );
        const label =
          kind === "sort"
            ? (actions.find((action) => action.state === "on")?.title ?? "Sort")
            : (actions.find((action) => action.state === "on")?.title ?? "No grouping");
        return (
          <ListFilterMenu
            key={kind}
            label={label}
            accessibilityLabel={kind === "sort" ? "Sort conversations" : "Group conversations"}
            active={
              kind === "sort"
                ? conversationList.conversationSortOrder !== "updated_at"
                : conversationList.conversationGrouping !== "none"
            }
            actions={actions}
            onSelect={(id) => {
              applyConversationListMenuEvent(id, conversationList);
            }}
          />
        );
      })}
    </ThreadListFilters>
  );
}
