import { useGT } from "gt-react-native";
import { processColor } from "react-native";
import { useDeviceUtilities } from "./utilitiesStore";
import { utilityColor } from "./utilityColors";

/** Native props for the Utilities item in the Android navigation bar and rail. */
export interface UtilitiesNavigation {
  readonly utilitiesLabel: string;
  readonly utilitiesColor: number;
}

export function useUtilitiesNavigation(dark: boolean): UtilitiesNavigation {
  const gt = useGT();
  const utilities = useDeviceUtilities();
  const color = processColor(utilityColor(utilities.aggregate, dark));
  return {
    utilitiesLabel: gt("Utilities, {aggregate}, {count} down", {
      aggregate: utilities.aggregate,
      count: utilities.statuses.filter((status) => status === "down").length,
    }),
    utilitiesColor: typeof color === "number" ? color : 0,
  };
}
