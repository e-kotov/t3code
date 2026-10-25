import { EDITORS } from "@t3tools/contracts";
import { editorLabelForPlatform } from "./editorLabels";

// Kept apart from forkEditorPreferences: editorLabels pulls in UI modules, which upstream's
// editorPreferences test does not mock.

/** Spoken name after opening; custom editors are named generically outside the picker. */
export function configuredEditorLabel(id: string, platform: string): string {
  const editor = EDITORS.find((candidate) => candidate.id === id);
  return editor ? editorLabelForPlatform(editor.id, platform) : "editor";
}
