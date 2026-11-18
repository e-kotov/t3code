import { useMessages } from "gt-react";
import { machineGroupConnectionStatus } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentPresentation } from "../state/presentation";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "./ConnectionStatusDot";

export function MachineGroupConnectionStatus(props: { environmentId: EnvironmentId }) {
  const messages = useMessages();
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  if (!presentation) return null;
  const phase = presentation.connection.phase;
  const status = machineGroupConnectionStatus(presentation.entry.target.label, phase, messages);
  if (!status) return null;

  return (
    <ConnectionStatusDot
      tooltipText={status.label}
      dotClassName={connectionPhaseDotClassName(phase)}
      pingClassName={connectionPhasePingClassName(phase)}
    />
  );
}
