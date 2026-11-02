import { ArrowDownWideNarrowIcon, CheckIcon, Layers2Icon } from "lucide-react";

import {
  getSidebarConversationSortCriterion,
  isSidebarConversationSortReversed,
  selectSidebarConversationSortOrder,
  type SidebarConversationSortCriterion,
} from "@t3tools/client-runtime/state/thread-sort";

import type { SidebarConversationGrouping } from "@t3tools/contracts/settings";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const SORT_CHOICES = [
  ["updated_at", "Recent activity", "Newest first", "Oldest first"],
  ["created_at", "Created", "Newest first", "Oldest first"],
  ["cache_expiry", "Cache expiry", "Soonest first", "Latest first"],
] as const satisfies ReadonlyArray<
  readonly [SidebarConversationSortCriterion, string, string, string]
>;

export function SidebarThreadListControls() {
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
            <MenuRadioGroup
              value={grouping}
              onValueChange={(value) =>
                void updateClientSettings({
                  sidebarConversationGrouping: value as SidebarConversationGrouping,
                })
              }
            >
              <MenuRadioItem value="none">No grouping</MenuRadioItem>
              <MenuRadioItem value="machine">By machine</MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </>
  );
}
