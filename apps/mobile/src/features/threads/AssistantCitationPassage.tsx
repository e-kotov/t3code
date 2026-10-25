import type { AssistantCitation } from "@t3tools/contracts";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentProps } from "react";
import { Platform, type ViewProps } from "react-native";
import Animated from "react-native-reanimated";

export interface AssistantCitationPassageTarget {
  readonly requestId: number;
  readonly rowId: string;
  readonly citation: AssistantCitation;
  readonly topInset: number;
}

const NativePassage =
  Platform.OS === "android" && requireOptionalNativeModule("T3CitationPassage")
    ? requireNativeView<ViewProps & { readonly targetJson: string }>("T3CitationPassage")
    : null;

export function AssistantCitationPassage({ rowId, target: requested, children, ...props }: ComponentProps<typeof Animated.View> & {
  readonly rowId: string;
  readonly target: AssistantCitationPassageTarget | null;
}) {
  const target = requested?.rowId === rowId ? requested : null;
  return (
    <Animated.View {...props}>
    {NativePassage ? <NativePassage
      style={{ minWidth: 0, flexShrink: 1 }}
      targetJson={target ? JSON.stringify({ ...target.citation, requestId: target.requestId, topInset: target.topInset }) : ""}
    >
      {children}
    </NativePassage> : children}
    </Animated.View>
  );
}
