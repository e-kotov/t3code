import { buildCustomEditorUrl } from "@t3tools/contracts";
import type { CustomEditor } from "../../forkEditorPreferences";

export function validateCustomEditor(editor: CustomEditor, remote: boolean): string | null {
  if (!editor.name.trim()) return "Enter an editor name.";
  if (remote) {
    return buildCustomEditorUrl(editor.remoteUrl.trim(), "example-host", "/workspace/project")
      ? null
      : "Use an app URL with {host} and {path} (or {pathQuery}), for example myeditor://ssh/{host}{path}.";
  }
  if (!editor.command.trim()) return "Enter an executable name or absolute path.";
  if (editor.command.includes("\0") || editor.args.some((arg) => arg.includes("\0")))
    return "Commands and arguments cannot contain null characters.";
  if (editor.args.some((arg) => /\{(?!path\}|line\}|column\})[^}]*\}/.test(arg)))
    return "Supported argument placeholders: {path}, {line}, {column}.";
  return null;
}
