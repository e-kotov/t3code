import type { EditorId, EnvironmentId, LaunchEditorInput } from "@t3tools/contracts";
import { mapAtomCommandResult, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { getLocalStorageItem } from "./hooks/useLocalStorage";
import { configuredEditorEntries, editorPreferencesKey, EditorPreferences, preferredConfiguredEditor } from "./forkEditorPreferences";

/** Extend file-opening actions only when this environment has saved preferences. */
export async function openSavedConfiguredEditor<E>(
  environmentId: EnvironmentId, detected: readonly EditorId[], target: string,
  invoke: (value: { environmentId: EnvironmentId; input: LaunchEditorInput }) => Promise<AtomCommandResult<void, E>>,
) {
  const key = editorPreferencesKey(environmentId, false);
  let preferences: EditorPreferences | null;
  try {
    if (typeof window === "undefined" || window.localStorage.getItem(key) === null) return null;
    preferences = getLocalStorageItem(key, EditorPreferences);
  } catch { return null; }
  if (preferences === null) return null;
  const entry = preferredConfiguredEditor(configuredEditorEntries(preferences, detected, false), preferences.preferred, getLocalStorageItem("t3code:last-editor", Schema.String));
  if (!entry) return AsyncResult.failure(Cause.fail(new Error("No editor is enabled for this environment.")));
  const input: LaunchEditorInput = entry.custom
    ? { cwd: target, editor: "custom", customEditor: { name: entry.name, command: entry.custom.command, args: entry.custom.args } }
    : { cwd: target, editor: entry.builtIn! };
  return mapAtomCommandResult(await invoke({ environmentId, input }), () => entry.id);
}
