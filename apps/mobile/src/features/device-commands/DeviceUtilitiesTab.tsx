import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { DeviceCommandsScreen } from "./DeviceCommandsScreen";
import { DeviceUtilitiesDetailPane } from "./DeviceUtilitiesDetailPane.android";

/** Utilities in upstream's extra-tab slot; beside the sidebar, the commands live in the sidebar. */
export function DeviceUtilitiesTab() {
  const { layout } = useAdaptiveWorkspaceLayout();
  return layout.usesSplitView ? <DeviceUtilitiesDetailPane /> : <DeviceCommandsScreen />;
}
