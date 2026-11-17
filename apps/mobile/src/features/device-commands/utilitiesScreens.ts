import { createNativeStackScreen } from "@react-navigation/native-stack";
import { DeviceCommandsScreen } from "./DeviceCommandsScreen";
import { UTILITIES_PRESENTATION, UTILITIES_ROUTE } from "./utilitiesRoute";

export const UTILITIES_SCREENS = {
  [UTILITIES_ROUTE]: createNativeStackScreen({
    screen: DeviceCommandsScreen,
    linking: "utilities",
    options: { ...UTILITIES_PRESENTATION, title: "Utilities" },
  }),
};
