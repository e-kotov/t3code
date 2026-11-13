import type { MenuAction } from "@react-native-menu/menu";
import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
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
  readonly workingOnly: boolean;
  readonly workingFirst: boolean;
}

export interface ConversationListControls extends ConversationListOptions {
  readonly onConversationSortOrderChange: (value: SidebarConversationSortCriterion) => void;
  readonly onConversationGroupingChange: (value: SidebarConversationGrouping) => void;
  readonly onWorkingOnlyChange: (value: boolean) => void;
  readonly onWorkingFirstChange: (value: boolean) => void;
}

export const DEFAULT_CONVERSATION_LIST_OPTIONS: ConversationListOptions = {
  conversationSortOrder: "updated_at",
  conversationGrouping: "none",
  workingOnly: false,
  workingFirst: false,
};

const SORT_CHOICES = [
  ["updated_at", "Recent activity"],
  ["created_at", "Created"],
  ["cache_expiry", "Cache expiry"],
] as const satisfies ReadonlyArray<readonly [SidebarConversationSortCriterion, string]>;

export function conversationListControls(
  options: ConversationListOptions,
  updateOptions: (patch: Partial<ConversationListOptions>) => void,
  onWorkingFilterEnabled?: () => void,
): ConversationListControls {
  return {
    conversationSortOrder: options.conversationSortOrder,
    conversationGrouping: options.conversationGrouping,
    workingOnly: options.workingOnly,
    workingFirst: options.workingFirst,
    onWorkingOnlyChange: (workingOnly) => {
      if (workingOnly && !options.workingOnly) onWorkingFilterEnabled?.();
      updateOptions({ workingOnly });
    },
    onWorkingFirstChange: (workingFirst) => updateOptions({ workingFirst }),
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
    options.conversationGrouping !== DEFAULT_CONVERSATION_LIST_OPTIONS.conversationGrouping ||
    options.workingOnly ||
    options.workingFirst
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
    return [
      ...SORT_CHOICES.map(([value, title]) => {
        const isSelected =
          getSidebarConversationSortCriterion(options.conversationSortOrder) === value;
        const direction = directionLabel(value, options.conversationSortOrder);
        return {
          id: `sort:${value}`,
          title: direction ? `${title} · ${direction}` : title,
          state: isSelected ? ("on" as const) : offState,
        };
      }),
      {
        id: "working:first",
        title: "Working above main list",
        state: options.workingFirst ? "on" : offState,
      },
    ];
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

/** Applies a `sort:*` or `grouping:*` menu event; returns whether the event was one. */
export function applyConversationListMenuEvent(
  event: string,
  controls: ConversationListControls,
): boolean {
  if (event === "working:first") {
    controls.onWorkingFirstChange(!controls.workingFirst);
    return true;
  }
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

/** Sort and grouping submenus for `buildHomeListFilterMenuItems`, present only with handlers. */
export function buildConversationListFilterSubmenus(
  props: Partial<ConversationListControls> & { readonly machineSummary?: string },
): AppBarMenuItem[] {
  const submenus: AppBarMenuItem[] = [];
  const onSortOrderChange = props.onConversationSortOrderChange;
  if (onSortOrderChange) {
    submenus.push({
      id: "sort",
      title: "Sort conversations",
      items: [
        ...SORT_CHOICES.map(([value, title]) => ({
          id: `sort:${value}`,
          title: `${title} · ${directionLabel(value, props.conversationSortOrder ?? "updated_at")}`,
          selected:
            getSidebarConversationSortCriterion(props.conversationSortOrder ?? "updated_at") ===
            value,
          onPress: () => onSortOrderChange(value),
        })),
        ...(props.onWorkingFirstChange
          ? [
              {
                id: "working:first",
                title: "Working above main list",
                selected: props.workingFirst ?? false,
                onPress: () => props.onWorkingFirstChange?.(!props.workingFirst),
              },
            ]
          : []),
      ],
    });
  }
  const onGroupingChange = props.onConversationGroupingChange;
  if (onGroupingChange) {
    const current = props.conversationGrouping ?? "none";
    const machineTitle = props.machineSummary
      ? `By machine · ${props.machineSummary}`
      : "By machine";
    submenus.push({
      id: "grouping",
      title: "Group conversations",
      items: [
        {
          id: "grouping:machine",
          title: machineTitle,
          selected: isSidebarMachineGrouping(current),
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


export type WorkingStatusFilterControls = Partial<
  Pick<ConversationListControls, "workingOnly" | "onWorkingOnlyChange">
>;

export function workingStatusActions(controls: WorkingStatusFilterControls): MenuAction[] {
  return controls.onWorkingOnlyChange
    ? [{ id: "working:only", title: "Working only", state: controls.workingOnly ? "on" : "off" }]
    : [];
}

export function applyWorkingStatusMenuEvent(
  event: string,
  controls: WorkingStatusFilterControls,
): boolean {
  if (event !== "working:only") return false;
  controls.onWorkingOnlyChange?.(!controls.workingOnly);
  return true;
}
