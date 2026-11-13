import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export function useWorkingSidebarPlacement() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return {
    savedWorkingFirst:
      preferences._tag === "Success" ? preferences.value.workingSidebarFirst : undefined,
    saveWorkingFirst: (workingSidebarFirst: boolean) => savePreferences({ workingSidebarFirst }),
  };
}
