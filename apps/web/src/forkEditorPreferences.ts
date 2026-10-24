import { EDITORS, EditorId, REMOTE_CAPABLE_EDITOR_IDS } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { editorLabelForPlatform } from "./editorLabels";
import { useLocalStorage } from "./hooks/useLocalStorage";

export const EditorVisibility = Schema.Literals(["auto", "show", "hide"]);
export type EditorVisibility = typeof EditorVisibility.Type;
export const CustomEditor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  remoteUrl: Schema.String,
  enabled: Schema.Boolean,
});
export type CustomEditor = typeof CustomEditor.Type;
export const EditorPreferences = Schema.Struct({
  builtIns: Schema.Array(Schema.Struct({ id: EditorId, visibility: EditorVisibility })),
  custom: Schema.Array(CustomEditor),
  preferred: Schema.NullOr(Schema.String),
});
export type EditorPreferences = typeof EditorPreferences.Type;
export const EMPTY_EDITOR_PREFERENCES: EditorPreferences = {
  builtIns: [],
  custom: [],
  preferred: null,
};

export function editorPreferencesKey(environmentId: string | null, remote: boolean) {
  return `t3code:editors:${remote ? "remote-device" : `environment:${environmentId ?? "none"}`}`;
}

export function resolveEditorPreferences(value: unknown): EditorPreferences {
  return Schema.is(EditorPreferences)(value) ? value : EMPTY_EDITOR_PREFERENCES;
}

export function useEditorPreferences(environmentId: string | null, remote: boolean) {
  const [preferences, setPreferences] = useLocalStorage(
    editorPreferencesKey(environmentId, remote),
    EMPTY_EDITOR_PREFERENCES,
    EditorPreferences,
  );
  return [resolveEditorPreferences(preferences), setPreferences] as const;
}

export function configuredEditorEntries(
  preferences: EditorPreferences,
  detected: readonly EditorId[],
  remote: boolean,
) {
  const builtIns = EDITORS.filter((editor) => {
    if (remote && !REMOTE_CAPABLE_EDITOR_IDS.includes(editor.id)) return false;
    const visibility =
      preferences.builtIns.find((entry) => entry.id === editor.id)?.visibility ?? "auto";
    return visibility === "show" || (visibility === "auto" && detected.includes(editor.id));
  }).map((editor) => ({
    id: editor.id as string,
    name: editor.label,
    builtIn: editor.id,
    custom: undefined as CustomEditor | undefined,
  }));
  const custom = preferences.custom
    .filter(
      (editor) => editor.enabled && (remote ? editor.remoteUrl.trim() : editor.command.trim()),
    )
    .map((editor) => ({ id: editor.id, name: editor.name, builtIn: undefined, custom: editor }));
  return [...builtIns, ...custom];
}

export function preferredConfiguredEditor(
  entries: ReturnType<typeof configuredEditorEntries>,
  preferred: string | null,
  legacy: string | null,
) {
  return (
    entries.find((entry) => entry.id === preferred) ??
    entries.find((entry) => entry.id === legacy) ??
    entries[0] ??
    null
  );
}

/** Spoken name after opening; custom editors are named generically outside the picker. */
export function configuredEditorLabel(id: string, platform: string): string {
  const editor = EDITORS.find((candidate) => candidate.id === id);
  return editor ? editorLabelForPlatform(editor.id, platform) : "editor";
}

export function setEditorVisibility(
  preferences: EditorPreferences,
  id: EditorId,
  visibility: EditorVisibility,
): EditorPreferences {
  return {
    ...preferences,
    builtIns: [...preferences.builtIns.filter((entry) => entry.id !== id), { id, visibility }],
  };
}

/** Add scoped defaults while retaining the existing built-in preference history. */
export function useConfiguredPreferredEditor(
  availableEditors: readonly EditorId[],
  environmentId: string | null,
  effectiveEditor: EditorId | null,
  setLastEditor: (id: EditorId) => void,
) {
  const [preferences, setPreferences] = useEditorPreferences(environmentId, false);
  const menuLabel = (id: EditorId | null) =>
    id === null || id === "file-manager"
      ? "Open in editor"
      : `Open in ${EDITORS.find((editor) => editor.id === id)?.label ?? "Editor"}`;
  if (environmentId === null)
    return [
      effectiveEditor,
      (id: string) => {
        const editor = EDITORS.find((candidate) => candidate.id === id);
        if (editor) setLastEditor(editor.id);
      },
      menuLabel(effectiveEditor),
    ] as const;
  const entries = configuredEditorEntries(preferences, availableEditors, false);
  const configured = preferredConfiguredEditor(entries, preferences.preferred, effectiveEditor);
  const label = configured?.builtIn
    ? menuLabel(configured.builtIn)
    : configured
      ? `Open in ${configured.name}`
      : "Open in editor";
  return [
    configured?.id ?? null,
    (id: string) => setPreferences((value) => ({ ...value, preferred: id })),
    label,
  ] as const;
}
