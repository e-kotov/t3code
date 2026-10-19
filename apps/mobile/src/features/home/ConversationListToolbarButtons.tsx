import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";
import {
  applyConversationListMenuEvent,
  conversationChoiceActions,
  type ConversationListControls,
} from "./conversationListOptions";

/** Android Home header buttons for the conversation sort and machine grouping menus. */
export function ConversationListToolbarButtons({
  controls,
}: {
  readonly controls: ConversationListControls;
}) {
  // Key the menu actions on the selected values, not the controls object, which
  // callers rebuild on every render.
  const { conversationSortOrder, conversationGrouping } = controls;
  const options = { conversationSortOrder, conversationGrouping };
  const onPressAction = (event: { readonly nativeEvent: { readonly event: string } }) => {
    applyConversationListMenuEvent(event.nativeEvent.event, controls);
  };
  return (
    <>
      <AndroidAnchoredMenu
        actions={conversationChoiceActions("sort", options, undefined)}
        onPressAction={onPressAction}
        title="Sort conversations"
      >
        {(open) => (
          <AndroidHeaderIconButton
            accessibilityLabel="Sort conversations"
            icon="arrow.up.arrow.down"
            selected={conversationSortOrder !== "updated_at"}
            onPress={open}
          />
        )}
      </AndroidAnchoredMenu>
      <AndroidAnchoredMenu
        actions={conversationChoiceActions("grouping", options, undefined)}
        onPressAction={onPressAction}
        title="Group conversations"
      >
        {(open) => (
          <AndroidHeaderIconButton
            accessibilityLabel="Group conversations"
            icon="square.3.layers.3d"
            selected={conversationGrouping !== "none"}
            onPress={open}
          />
        )}
      </AndroidAnchoredMenu>
    </>
  );
}
