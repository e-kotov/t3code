import { parseFileUrlHref, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { safeDecodeURIComponent } from "@t3tools/shared/markdownLinks";
import type { EditorId, EnvironmentId, LaunchEditorInput } from "@t3tools/contracts";
import {
  mapAtomCommandResult,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { getLocalStorageItem } from "./hooks/useLocalStorage";
import {
  configuredEditorEntries,
  editorPreferencesKey,
  EditorPreferences,
  preferredConfiguredEditor,
} from "./forkEditorPreferences";

/** Extend file-opening actions only when this environment has saved preferences. */
export async function openSavedConfiguredEditor<E>(
  environmentId: EnvironmentId,
  detected: readonly EditorId[],
  target: string,
  invoke: (value: {
    environmentId: EnvironmentId;
    input: LaunchEditorInput;
  }) => Promise<AtomCommandResult<void, E>>,
  projectRoot?: string,
) {
  const key = editorPreferencesKey(environmentId, false);
  let preferences: EditorPreferences | null;
  try {
    if (typeof window === "undefined" || window.localStorage.getItem(key) === null) return null;
    preferences = getLocalStorageItem(key, EditorPreferences);
  } catch {
    return null;
  }
  if (preferences === null) return null;
  let legacy: string | null = null;
  try {
    legacy = getLocalStorageItem("t3code:last-editor", Schema.String);
  } catch {
    // An invalid legacy value must not block the saved editor configuration.
  }
  const entry = preferredConfiguredEditor(
    configuredEditorEntries(preferences, detected, false),
    preferences.preferred,
    legacy,
  );
  if (!entry)
    return AsyncResult.failure<string, Error>(
      Cause.fail(new Error("No editor is enabled for this environment.")),
    );
  const uri = /^file:\/\//iu.test(target) ? parseFileUrlHref(target) : null;
  const { line, column } = uri ? splitFilePathPosition("", uri.hash) : {};
  const location = {
    cwd: uri ? safeDecodeURIComponent(uri.path) : target,
    ...(uri ? { position: { line, column } } : {}),
  };
  const input: LaunchEditorInput = entry.custom
    ? {
        ...location,
        editor: "custom",
        customEditor: { name: entry.name, command: entry.custom.command, args: entry.custom.args },
      }
    : { ...location, editor: entry.builtIn! };
  return mapAtomCommandResult(
    await invoke({ environmentId, input: { ...input, ...(projectRoot ? { projectRoot } : {}) } }),
    () => entry.id,
  );
}
