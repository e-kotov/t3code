import type { ComponentProps } from "react";
import { machineConnectionSettingsTargetId } from "./machineConnectionSettingsTarget";
import { SavedBackendListRow } from "./SavedEnvironmentRows";
import { SettingsSearchTarget } from "./settingsLayout";

export function TargetedMachineConnectionRow(props: ComponentProps<typeof SavedBackendListRow>) {
  return (
    <SettingsSearchTarget id={machineConnectionSettingsTargetId(props.environment.environmentId)}>
      <SavedBackendListRow {...props} />
    </SettingsSearchTarget>
  );
}
