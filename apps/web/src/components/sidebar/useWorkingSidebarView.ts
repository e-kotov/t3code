import * as Schema from "effect/Schema";
import { useLocalStorage, writeLocalStorageValue } from "../../hooks/useLocalStorage";

export function useWorkingSidebarView() {
  const [workingOnly, setWorkingOnly] = useLocalStorage(
    "t3code:sidebar-working-only",
    false,
    Schema.Boolean,
  );
  const [workingFirst, setWorkingFirst] = useLocalStorage(
    "t3code:sidebar-working-first",
    false,
    Schema.Boolean,
  );
  const updateWorkingOnly = (checked: boolean) => {
    if (checked) {
      writeLocalStorageValue("t3code:sidebar:working-expanded", true, false, Schema.Boolean);
    }
    setWorkingOnly(checked);
  };
  return { workingOnly, setWorkingOnly: updateWorkingOnly, workingFirst, setWorkingFirst };
}
