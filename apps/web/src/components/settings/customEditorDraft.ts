import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
import { buildCustomEditorUrl } from "@t3tools/contracts";
import type { CustomEditor } from "../../forkEditorPreferences";

export function validateCustomEditor(
  editor: CustomEditor,
  remote: boolean,
  resolve: MessageResolver = m,
): string | null {
  if (!editor.name.trim()) return resolve(msg("Enter an editor name."));
  if (remote) {
    return buildCustomEditorUrl(editor.remoteUrl.trim(), "example-host", "/workspace/project")
      ? null
      : resolve(
          msg(
            "Use an app URL with {host} and {path} (or {pathQuery}), for example myeditor://ssh/{host}{path}.",
            { host: "{host}", path: "{path}", pathQuery: "{pathQuery}" },
          ),
        );
  }
  if (!editor.command.trim()) return resolve(msg("Enter an executable name or absolute path."));
  if (editor.command.includes("\0") || editor.args.some((arg) => arg.includes("\0")))
    return resolve(msg("Commands and arguments cannot contain null characters."));
  if (editor.args.some((arg) => /\{(?!path\}|line\}|column\})[^}]*\}/.test(arg)))
    return resolve(
      msg("Supported argument placeholders: {path}, {line}, {column}.", {
        path: "{path}",
        line: "{line}",
        column: "{column}",
      }),
    );
  return null;
}
