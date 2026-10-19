import { Toolbar } from "../../components/ui/Toolbar";
import {
  applyConversationListMenuEvent,
  conversationChoiceActions,
  type ConversationListControls,
} from "./conversationListOptions";

/**
 * iOS toolbar submenus for conversation sort and machine grouping. A plain
 * function, not a component: the native toolbar reads `Toolbar.Menu` children
 * by element type, and a wrapper component would hide them.
 */
export function renderConversationListToolbarMenus(controls: ConversationListControls) {
  return (
    <>
      {(
        [
          ["sort", "Sort conversations"],
          ["grouping", "Group conversations"],
        ] as const
      ).map(([kind, title]) => (
        <Toolbar.Menu key={kind} title={title}>
          <Toolbar.Label>{title}</Toolbar.Label>
          {conversationChoiceActions(kind, controls, undefined).map((action) => (
            <Toolbar.MenuAction
              key={action.id}
              isOn={action.state === "on"}
              onPress={() => {
                applyConversationListMenuEvent(action.id ?? "", controls);
              }}
            >
              <Toolbar.Label>{action.title}</Toolbar.Label>
            </Toolbar.MenuAction>
          ))}
        </Toolbar.Menu>
      ))}
    </>
  );
}
