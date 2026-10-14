import type * as Path from "effect/Path";

export function forkEditorMacBundleCandidates(
  editorId: string,
  contents: string,
  path: Path.Path,
): string[] {
  // Gram ships a separate CLI; its GUI executable is not the launcher.
  return editorId === "gram" ? [path.join(contents, "MacOS/cli")] : [];
}
