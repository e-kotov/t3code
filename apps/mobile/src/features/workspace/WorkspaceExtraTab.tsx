import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { UsageRouteScreen } from "../usage/UsageRouteScreen";
import { DeviceUtilitiesTab } from "../device-commands/DeviceUtilitiesTab";

export function WorkspaceExtraTab(_props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests"> | "commands";
}) {
  if (_props.tab === "commands") return <DeviceUtilitiesTab />;
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <UsageRouteScreen workspace />
    </>
  );
}
