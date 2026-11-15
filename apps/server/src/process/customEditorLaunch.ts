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

export function expandLaunchEditorInput(
  input: LaunchEditorInput,
  home: string,
  expand: (value: string, home: string) => string,
): LaunchEditorInput {
  const cwd = expand(input.cwd, home);
  if (input.editor === "custom" || input.projectRoot === undefined) {
    return { ...input, cwd };
  }
  return { ...input, cwd, projectRoot: expand(input.projectRoot, home) };
}
