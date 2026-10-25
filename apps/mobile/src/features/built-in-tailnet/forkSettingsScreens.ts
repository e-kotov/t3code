import { createNativeStackScreen } from "@react-navigation/native-stack";
import { SettingsBuiltInTailscaleRouteScreen } from "./SettingsBuiltInTailscaleRouteScreen";

export const FORK_SETTINGS_SCREENS = {
  SettingsBuiltInTailscale: createNativeStackScreen({
    screen: SettingsBuiltInTailscaleRouteScreen,
    linking: "settings/built-in-tailscale",
    options: { title: "Built-in Tailscale" },
  }),
};
