import type { AssistantCitation } from "@t3tools/contracts";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentProps } from "react";
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";
import Animated from "react-native-reanimated";
import type { AssistantCitationPassageLocation } from "../../lib/assistantCitationPassage";

export interface AssistantCitationPassageTarget {
  readonly requestId: number;
  readonly rowId: string;
  readonly citation: AssistantCitation;
  readonly topInset: number;
}

const NativePassage =
  Platform.OS === "android" && requireOptionalNativeModule("T3CitationPassage")
    ? requireNativeView<
        ViewProps & {
          readonly targetJson: string;
          readonly onLocated: (
            event: NativeSyntheticEvent<AssistantCitationPassageLocation>,
          ) => void;
        }
      >("T3CitationPassage")
    : null;

export function AssistantCitationPassage({
  rowId,
  target: requested,
  onLocated,
  children,
  ...props
}: ComponentProps<typeof Animated.View> & {
  readonly rowId: string;
  readonly target: AssistantCitationPassageTarget | null;
  readonly onLocated: (location: AssistantCitationPassageLocation) => void;
}) {
  const target = requested?.rowId === rowId ? requested : null;
  return (
    <Animated.View {...props} collapsable={false}>
      {children}
      {NativePassage && target ? (
        <NativePassage
          pointerEvents="none"
          style={{ position: "absolute", width: 0, height: 0 }}
          targetJson={JSON.stringify({
            ...target.citation,
            requestId: target.requestId,
            topInset: target.topInset,
          })}
          onLocated={({ nativeEvent }) => onLocated(nativeEvent)}
        />
      ) : null}
    </Animated.View>
  );
}
