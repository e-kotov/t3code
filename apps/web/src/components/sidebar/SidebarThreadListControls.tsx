import { ArrowDownWideNarrowIcon, CheckIcon, Layers2Icon } from "lucide-react";

import {
  getSidebarConversationSortCriterion,
  isSidebarConversationSortReversed,
  selectSidebarConversationSortOrder,
  type SidebarConversationSortCriterion,
} from "@t3tools/client-runtime/state/thread-sort";

import {
  isSidebarMachineGrouping,
  isSidebarProjectGrouping,
  toggleSidebarGroupingDimension,
} from "@t3tools/contracts/settings";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const SORT_CHOICES = [
  ["updated_at", "Recent activity", "Newest first", "Oldest first"],
  ["created_at", "Created", "Newest first", "Oldest first"],
  ["cache_expiry", "Cache expiry", "Soonest first", "Latest first"],
] as const satisfies ReadonlyArray<
  readonly [SidebarConversationSortCriterion, string, string, string]
>;

export interface SidebarThreadListControlsProps {
  readonly machineSummary?: string;
  readonly projectSummary?: string;
}

export function SidebarThreadListControls(props: SidebarThreadListControlsProps = {}) {
  const sortOrder = useClientSettings((s) => s.sidebarConversationSortOrder);
  const grouping = useClientSettings((s) => s.sidebarConversationGrouping);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <SidebarHeaderIconButton label="Sort conversations">
              <ArrowDownWideNarrowIcon />
            </SidebarHeaderIconButton>
          }
        />
        <MenuPopup align="end" side="bottom">
          <MenuGroup>
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Sort conversations
            </div>
            {SORT_CHOICES.map(([criterion, label, defaultDirection, reverseDirection]) => {
              const selected = getSidebarConversationSortCriterion(sortOrder) === criterion;
              const reversed = selected && isSidebarConversationSortReversed(sortOrder);
              return (
                <MenuItem
                  key={criterion}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() =>
                    void updateClientSettings({
                      sidebarConversationSortOrder: selectSidebarConversationSortOrder(
                        sortOrder,
                        criterion,
                      ),
                    })
                  }
                >
                  {selected ? <CheckIcon aria-hidden="true" /> : <span className="size-4" />}
                  <span className="min-w-0 flex-1">{label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {reversed ? reverseDirection : defaultDirection}
                  </span>
                </MenuItem>
              );
            })}
          </MenuGroup>
        </MenuPopup>
      </Menu>
      <Menu>
        <MenuTrigger
          render={
            <SidebarHeaderIconButton label="Group conversations">
              <Layers2Icon />
            </SidebarHeaderIconButton>
          }
        />
        <MenuPopup align="end" side="bottom">
          <MenuGroup>
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
              Group conversations
            </div>
            <MenuCheckboxItem
              checked={isSidebarMachineGrouping(grouping)}
              onCheckedChange={() =>
                void updateClientSettings({
                  sidebarConversationGrouping: toggleSidebarGroupingDimension(grouping, "machine"),
                })
              }
            >
              <span className="flex min-w-0 items-center justify-between gap-3 w-full">
                <span className="min-w-0 truncate">By machine</span>
                {props.machineSummary ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {props.machineSummary}
                  </span>
                ) : null}
              </span>
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={isSidebarProjectGrouping(grouping)}
              onCheckedChange={() =>
                void updateClientSettings({
                  sidebarConversationGrouping: toggleSidebarGroupingDimension(grouping, "project"),
                })
              }
            >
              <span className="flex min-w-0 items-center justify-between gap-3 w-full">
                <span className="min-w-0 truncate">By project</span>
                {props.projectSummary ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {props.projectSummary}
                  </span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </>
  );
}
