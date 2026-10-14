export const FORK_EDITORS = [
  {
    id: "positron",
    label: "Positron",
    commands: ["positron"],
    launchStyle: "goto",
    remoteScheme: "positron",
  },
  {
    id: "gram",
    label: "Gram",
    commands: ["gram"],
    launchStyle: "direct-path",
    remoteScheme: "gram",
  },
] as const;

/** Gram documents gram://ssh/<host>/<path>, rather than VS Code's URI shape. */
export function buildGramRemoteOpenUrl(host: string, absolutePath: string): string {
  const posixPath = absolutePath.replaceAll("\\", "/");
  const rootedPath = posixPath.startsWith("/") ? posixPath : `/${posixPath}`;
  const encodedPath = rootedPath.split("/").map(encodeURIComponent).join("/");
  return `gram://ssh/${encodeURIComponent(host)}${encodedPath}`;
}
