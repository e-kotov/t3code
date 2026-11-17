import type { NavigationState } from "@react-navigation/native";

export const UTILITIES_ROUTE = "DeviceUtilities";
export const UTILITIES_PRESENTATION = { presentation: "fullScreenModal" } as const;

export function utilitiesOpenAction(state: Pick<NavigationState, "key" | "routes" | "index">) {
  if (state.routes[state.index]?.name === UTILITIES_ROUTE) return null;
  return {
    type: "NAVIGATE" as const,
    payload: { name: UTILITIES_ROUTE },
    target: state.key,
  };
}
