import { useSearch } from "@tanstack/react-router";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { useEnvironments } from "../../state/environments";
import { MachinePickerIndicators } from "../MachinePickerIndicators";
import { EnvironmentRow } from "./EnvironmentRow";
import { machineConnectionSettingsTargetId } from "./machineConnectionSettingsTarget";
import { SettingsSearchTarget } from "./settingsLayout";

export function TargetedLocalMachineConnection() {
  const machine = useSearch({ strict: false, select: (search) => search.machine });
  const { environments } = useEnvironments();
  const environment = environments.find((candidate) => candidate.environmentId === machine);
  if (
    !environment ||
    (environment.entry.target._tag !== "PrimaryConnectionTarget" &&
      !isDesktopLocalConnectionTarget(environment.entry.target))
  ) {
    return null;
  }
  return (
    <SettingsSearchTarget id={machineConnectionSettingsTargetId(environment.environmentId)}>
      <EnvironmentRow
        kind={resolveEnvironmentMachineKind(environment.serverConfig)}
        label={environment.label}
        subtitle={connectionStatusText(environment.connection)}
      >
        <MachinePickerIndicators environmentId={environment.environmentId} />
      </EnvironmentRow>
    </SettingsSearchTarget>
  );
}
