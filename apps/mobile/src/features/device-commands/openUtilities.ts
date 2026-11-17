import { rootNavigationRef } from "../../lib/rootNavigation";
import { utilitiesOpenAction } from "./utilitiesRoute";

export function openUtilities() {
  if (!rootNavigationRef.isReady()) return;
  const state = rootNavigationRef.getRootState();
  if (!state) return;
  const action = utilitiesOpenAction(state);
  if (action) rootNavigationRef.dispatch(action);
}
