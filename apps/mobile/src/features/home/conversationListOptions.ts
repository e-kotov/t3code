import type { MenuAction } from "@react-native-menu/menu";
import {
  getSidebarConversationSortCriterion,
  isSidebarConversationSortReversed,
  selectSidebarConversationSortOrder,
  type SidebarConversationSortCriterion,
} from "@t3tools/client-runtime/state/thread-sort";
import {
  isSidebarMachineGrouping,
  toggleSidebarGroupingDimension,
  type SidebarConversationGrouping,
  type SidebarConversationSortOrder,
} from "@t3tools/contracts";

/** Fork conversation sort and machine grouping, held with the Home list options. */
export interface ConversationListOptions {
  readonly conversationSortOrder: SidebarConversationSortOrder;
  readonly conversationGrouping: SidebarConversationGrouping;
}

export interface ConversationListControls extends ConversationListOptions {
  readonly onConversationSortOrderChange: (value: SidebarConversationSortCriterion) => void;
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
] as const satisfies ReadonlyArray<readonly [SidebarConversationSortCriterion, string]>;

export function conversationListControls(
  options: ConversationListOptions,
  updateOptions: (patch: Partial<ConversationListOptions>) => void,
): ConversationListControls {
  return {
    conversationSortOrder: options.conversationSortOrder,
    conversationGrouping: options.conversationGrouping,
    onConversationSortOrderChange: (value) => {
      updateOptions({
        conversationSortOrder: selectSidebarConversationSortOrder(
          options.conversationSortOrder,
          value,
        ),
      });
    },
    onConversationGroupingChange: (value) => {
      updateOptions({ conversationGrouping: value });
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
  machineSummary?: string,
): MenuAction[] {
  if (kind === "sort") {
    return SORT_CHOICES.map(([value, title]) => {
      const isSelected =
        getSidebarConversationSortCriterion(options.conversationSortOrder) === value;
      const direction = directionLabel(
        value as SidebarConversationSortCriterion,
        options.conversationSortOrder,
      );
      return {
        id: `sort:${value}`,
        title: direction ? `${title} · ${direction}` : title,
        state: isSelected ? ("on" as const) : offState,
      };
    });
  }
  const machineTitle = machineSummary ? `By machine · ${machineSummary}` : "By machine";
  return [
    {
      id: "grouping:machine",
      title: machineTitle,
      state: isSidebarMachineGrouping(options.conversationGrouping) ? ("on" as const) : offState,
    },
  ];
}

export function conversationListMenuActions(
  options: ConversationListOptions,
  machineSummary?: string,
): MenuAction[] {
  return [
    {
      id: "sort",
      title: "Sort conversations",
      subactions: conversationChoiceActions("sort", options, "off", machineSummary),
    },
    {
      id: "grouping",
      title: "Group conversations",
      subactions: conversationChoiceActions("grouping", options, "off", machineSummary),
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
  if (event === "grouping:machine") {
    controls.onConversationGroupingChange(
      toggleSidebarGroupingDimension(controls.conversationGrouping, "machine"),
    );
    return true;
  }
  return false;
}

/** Sort and grouping submenus for `buildHomeListFilterMenu`, present only with handlers. */
export function buildConversationListFilterSubmenus(
  props: Partial<ConversationListControls> & { readonly machineSummary?: string },
) {
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
        title: `${title} · ${directionLabel(value, props.conversationSortOrder ?? "updated_at")}`,
        state:
          getSidebarConversationSortCriterion(props.conversationSortOrder ?? "updated_at") === value
            ? ("on" as const)
            : ("off" as const),
        onPress: () => onSortOrderChange(value),
      })),
    });
  }
  const onGroupingChange = props.onConversationGroupingChange;
  if (onGroupingChange) {
    const current = props.conversationGrouping ?? "none";
    const machineTitle = props.machineSummary
      ? `By machine · ${props.machineSummary}`
      : "By machine";
    submenus.push({
      type: "submenu",
      title: "Group conversations",
      items: [
        {
          type: "action" as const,
          title: machineTitle,
          state: isSidebarMachineGrouping(current) ? ("on" as const) : ("off" as const),
          onPress: () => onGroupingChange(toggleSidebarGroupingDimension(current, "machine")),
        },
      ],
    });
  }
  return submenus;
}

function directionLabel(
  criterion: SidebarConversationSortCriterion,
  order: SidebarConversationSortOrder,
): string {
  const reversed =
    getSidebarConversationSortCriterion(order) === criterion &&
    isSidebarConversationSortReversed(order);
  if (criterion === "cache_expiry") return reversed ? "Latest first" : "Soonest first";
  return reversed ? "Oldest first" : "Newest first";
}
