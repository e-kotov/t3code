import { RNHostView } from "@expo/ui/jetpack-compose";
import { size } from "@expo/ui/jetpack-compose/modifiers";
import { Pressable } from "react-native";
import { MachineGroupConnectionStatus } from "../threads/MachineGroupConnectionStatus";

export function MachineFilterMenuStatus(props: {
  readonly environmentId: string;
  readonly size: number;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <RNHostView matchContents modifiers={[size(props.size, props.size)]}>
      <Pressable
        accessible={false}
        focusable={false}
        importantForAccessibility="no-hide-descendants"
        disabled={props.disabled}
        onPress={props.onPress}
        style={{ width: props.size, height: props.size, alignItems: "center", justifyContent: "center" }}
      >
        <MachineGroupConnectionStatus environmentId={props.environmentId} />
      </Pressable>
    </RNHostView>
  );
}
