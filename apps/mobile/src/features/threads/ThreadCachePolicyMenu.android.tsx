import { cloneElement, type ReactElement } from "react";
import type { PressableProps } from "react-native";
import type { ComponentProps } from "react";
import { Menu } from "../../components/ui/Menu";
import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";

export function ThreadCachePolicyMenu(props: ComponentProps<typeof Menu>) {
  return (
    <AndroidAnchoredMenu
      title={props.title}
      actions={props.actions}
      onPressAction={props.onPressAction}
    >
      {(open) =>
        cloneElement(props.children as ReactElement<PressableProps>, {
          onPress: (event) => {
            event.stopPropagation();
            open();
          },
        })
      }
    </AndroidAnchoredMenu>
  );
}
