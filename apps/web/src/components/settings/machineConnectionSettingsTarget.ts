import type { EnvironmentId } from "@t3tools/contracts";

export function machineConnectionSettingsTargetId(environmentId: EnvironmentId) {
  return `machine-connection-${environmentId}`;
}
