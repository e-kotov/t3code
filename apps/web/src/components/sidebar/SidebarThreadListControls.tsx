import { ArrowDownWideNarrowIcon, Layers2Icon } from "lucide-react";

import type {
  SidebarConversationGrouping,
  SidebarConversationSortOrder,
} from "@t3tools/contracts/settings";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export function SidebarThreadListControls(props: {
  readonly sortOrder: SidebarConversationSortOrder;
  readonly grouping: SidebarConversationGrouping;
  readonly onSortOrderChange: (value: SidebarConversationSortOrder) => void;
  readonly onGroupingChange: (value: SidebarConversationGrouping) => void;
}) {
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
            <MenuRadioGroup
              value={props.sortOrder}
              onValueChange={(value) =>
                props.onSortOrderChange(value as SidebarConversationSortOrder)
              }
            >
              <MenuRadioItem value="updated_at">Recent activity</MenuRadioItem>
              <MenuRadioItem value="created_at">Created</MenuRadioItem>
              <MenuRadioItem value="cache_expiry">Cache expiry</MenuRadioItem>
            </MenuRadioGroup>
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
              value={props.grouping}
              onValueChange={(value) =>
                props.onGroupingChange(value as SidebarConversationGrouping)
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
