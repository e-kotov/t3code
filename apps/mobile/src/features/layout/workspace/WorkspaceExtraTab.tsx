import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { DeviceUtilitiesTab } from "../../device-commands/DeviceUtilitiesTab";

export function WorkspaceExtraTab(_props: { tab: Extract<NavigationTab, "usage"> | "commands" }) {
  if (_props.tab === "commands") return <DeviceUtilitiesTab />;
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <UsageRouteScreen workspace />
    </>
  );
}
