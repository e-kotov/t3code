import { machineGroupConnectionStatus } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";

import { useEnvironmentPresentation } from "../../state/presentation";
import { ConnectionStatusDot } from "../connection/ConnectionStatusDot";

export function MachineGroupConnectionStatus(props: { readonly environmentId?: string }) {
  const { presentation } = useEnvironmentPresentation(
    props.environmentId ? EnvironmentId.make(props.environmentId) : null,
  );
  if (!presentation) return null;
  const phase = presentation.connection.phase;
  const status = machineGroupConnectionStatus(presentation.entry.target.label, phase);
  if (!status) return null;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={status.label}>
      <ConnectionStatusDot state={phase} pulse={status.pulse} size={8} />
    </View>
  );
}
