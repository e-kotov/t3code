import { customEditorArguments, type LaunchEditorInput } from "@t3tools/contracts";

export function customEditorLaunch(input: LaunchEditorInput) {
  if (input.editor !== "custom") return undefined;
  return {
    editor: "custom" as const,
    target: input.cwd,
    command: input.customEditor.command,
    args: customEditorArguments(input.customEditor.args, input.cwd),
  };
}
