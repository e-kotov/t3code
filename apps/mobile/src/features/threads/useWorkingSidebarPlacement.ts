import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";

export function useWorkingSidebarPlacement() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  return {
    savedWorkingFirst:
      preferences._tag === "Success" ? preferences.value.workingSidebarFirst : undefined,
    saveWorkingFirst: (workingSidebarFirst: boolean) => savePreferences({ workingSidebarFirst }),
  };
}
