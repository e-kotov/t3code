import { processColor } from "react-native";
import { useDeviceUtilities } from "./utilitiesStore";
import { utilityColor } from "./utilityColors";

/** Native props for the Utilities item in the Android navigation bar and rail. */
export interface UtilitiesNavigation {
  readonly utilitiesLabel: string;
  readonly utilitiesColor: number;
}

function utilitiesNavigationLabel(aggregate: string, statuses: readonly string[]) {
  return `Utilities, ${aggregate}, ${statuses.filter((status) => status === "down").length} down`;
}

export function useUtilitiesNavigation(dark: boolean): UtilitiesNavigation {
  const utilities = useDeviceUtilities();
  const color = processColor(utilityColor(utilities.aggregate, dark));
  return {
    utilitiesLabel: utilitiesNavigationLabel(utilities.aggregate, utilities.statuses),
    utilitiesColor: typeof color === "number" ? color : 0,
  };
}
