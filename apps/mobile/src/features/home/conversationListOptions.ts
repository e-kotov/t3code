import type { MenuAction } from "@react-native-menu/menu";
import type { SidebarConversationGrouping, SidebarConversationSortOrder } from "@t3tools/contracts";
import type { Dispatch, SetStateAction } from "react";

/** Fork conversation sort and machine grouping, held with the Home list options. */
export interface ConversationListOptions {
  readonly conversationSortOrder: SidebarConversationSortOrder;
  readonly conversationGrouping: SidebarConversationGrouping;
}

export interface ConversationListControls extends ConversationListOptions {
  readonly onConversationSortOrderChange: (value: SidebarConversationSortOrder) => void;
  readonly onConversationGroupingChange: (value: SidebarConversationGrouping) => void;
}

export const DEFAULT_CONVERSATION_LIST_OPTIONS: ConversationListOptions = {
  conversationSortOrder: "updated_at",
  conversationGrouping: "none",
};

const SORT_CHOICES = [
  ["updated_at", "Recent activity"],
  ["created_at", "Created"],
  ["cache_expiry", "Cache expiry"],
] as const satisfies ReadonlyArray<readonly [SidebarConversationSortOrder, string]>;

const GROUPING_CHOICES = [
  ["none", "No grouping"],
  ["machine", "By machine"],
] as const satisfies ReadonlyArray<readonly [SidebarConversationGrouping, string]>;

export function conversationListControls<T extends ConversationListOptions>(
  options: ConversationListOptions,
  setOptions: Dispatch<SetStateAction<T>>,
): ConversationListControls {
  return {
    conversationSortOrder: options.conversationSortOrder,
    conversationGrouping: options.conversationGrouping,
    onConversationSortOrderChange: (value) => {
      setOptions((current) => ({ ...current, conversationSortOrder: value }));
    },
    onConversationGroupingChange: (value) => {
      setOptions((current) => ({ ...current, conversationGrouping: value }));
    },
  };
}

export function isConversationListCustomized(options: ConversationListOptions): boolean {
  return (
    options.conversationSortOrder !== DEFAULT_CONVERSATION_LIST_OPTIONS.conversationSortOrder ||
    options.conversationGrouping !== DEFAULT_CONVERSATION_LIST_OPTIONS.conversationGrouping
  );
}

/**
 * Native menu actions for the sort and grouping choices. Android header menus
 * leave unchecked choices without a state; the sidebar menu marks them "off".
 */
export function conversationChoiceActions(
  kind: "sort" | "grouping",
  options: ConversationListOptions,
  offState: "off" | undefined,
): MenuAction[] {
  const choices: ReadonlyArray<readonly [string, string]> =
    kind === "sort" ? SORT_CHOICES : GROUPING_CHOICES;
  const selected = kind === "sort" ? options.conversationSortOrder : options.conversationGrouping;
  return choices.map(([value, title]) => ({
    id: `${kind}:${value}`,
    title,
    state: selected === value ? ("on" as const) : offState,
  }));
}

export function conversationListMenuActions(options: ConversationListOptions): MenuAction[] {
  return [
    {
      id: "sort",
      title: "Sort conversations",
      subactions: conversationChoiceActions("sort", options, "off"),
    },
    {
      id: "grouping",
      title: "Group conversations",
      subactions: conversationChoiceActions("grouping", options, "off"),
    },
  ];
}

/** Applies a `sort:*` or `grouping:*` menu event; returns whether the event was one. */
export function applyConversationListMenuEvent(
  event: string,
  controls: ConversationListControls,
): boolean {
  if (event.startsWith("sort:")) {
    const value = event.slice("sort:".length);
    const choice = SORT_CHOICES.find(([candidate]) => candidate === value);
    if (choice) controls.onConversationSortOrderChange(choice[0]);
    return true;
  }
  if (event.startsWith("grouping:")) {
    const value = event.slice("grouping:".length);
    const choice = GROUPING_CHOICES.find(([candidate]) => candidate === value);
    if (choice) controls.onConversationGroupingChange(choice[0]);
    return true;
  }
  return false;
}

/** Sort and grouping submenus for `buildHomeListFilterMenu`, present only with handlers. */
export function buildConversationListFilterSubmenus(props: Partial<ConversationListControls>) {
  const submenus: Array<{
    readonly type: "submenu";
    readonly title: string;
    readonly items: Array<{
      readonly type: "action";
      readonly title: string;
      readonly state: "on" | "off";
      readonly onPress: () => void;
    }>;
  }> = [];
  const onSortOrderChange = props.onConversationSortOrderChange;
  if (onSortOrderChange) {
    submenus.push({
      type: "submenu",
      title: "Sort conversations",
      items: SORT_CHOICES.map(([value, title]) => ({
        type: "action" as const,
        title,
        state: props.conversationSortOrder === value ? ("on" as const) : ("off" as const),
        onPress: () => onSortOrderChange(value),
      })),
    });
  }
  const onGroupingChange = props.onConversationGroupingChange;
  if (onGroupingChange) {
    submenus.push({
      type: "submenu",
      title: "Group conversations",
      items: GROUPING_CHOICES.map(([value, title]) => ({
        type: "action" as const,
        title,
        state: props.conversationGrouping === value ? ("on" as const) : ("off" as const),
        onPress: () => onGroupingChange(value),
      })),
    });
  }
  return submenus;
}
