import { useGT, useMessages } from "gt-react-native";
import type { ComponentProps } from "react";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
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
  const gt = useGT();
  const m = useMessages();
  return (
    <ThreadListFilters
      {...props}
      workingOnly={conversationList.workingOnly}
      onWorkingOnlyChange={conversationList.onWorkingOnlyChange}
    >
      {(["sort", "grouping"] as const).map((kind) => {
        const actions = conversationChoiceActions(
          kind,
          conversationList,
          undefined,
          machineSummary,
          m,
        );
        const label =
          kind === "sort"
            ? (actions.find((action) => action.state === "on")?.title ??
              gt("Sort", { $context: "verb" }))
            : (actions.find((action) => action.state === "on")?.title ?? gt("No grouping"));
        return (
          <ListFilterMenu
            key={kind}
            label={label}
            accessibilityLabel={
              kind === "sort" ? gt("Sort conversations") : gt("Group conversations")
            }
            active={
              kind === "sort"
                ? conversationList.conversationSortOrder !== "updated_at" ||
                  conversationList.workingFirst
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
