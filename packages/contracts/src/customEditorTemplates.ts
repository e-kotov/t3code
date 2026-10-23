/** Custom editor substitutions are argv values, never shell source. */
function editorTarget(target: string) {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(target);
  return { path: match?.[1] ?? target, line: match?.[2] ?? "1", column: match?.[3] ?? "1" };
}

export function customEditorArguments(args: readonly string[], target: string): string[] {
  const values = editorTarget(target);
  const expanded = args.map((arg) =>
    arg.replace(/\{(path|line|column)\}/g, (_, key: keyof typeof values) => values[key]),
  );
  return args.some((arg) => arg.includes("{path}")) ? expanded : [...expanded, values.path];
}

// These are editor app links, never script, file, web, or OS-settings URLs.
const forbiddenSchemes = new Set([
  "javascript",
  "data",
  "file",
  "http",
  "https",
  "vbscript",
  "blob",
  "about",
  "chrome",
  "chrome-extension",
  "devtools",
  "shell",
  "ms-settings",
  "x-apple.systempreferences",
]);

export function buildCustomEditorUrl(
  template: string,
  host: string,
  target: string,
): string | undefined {
  if (!template.includes("{host}") || !/\{path(?:Query)?\}/.test(template)) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(template)?.[1]?.toLowerCase();
  // oxlint-disable-next-line no-control-regex -- App links reject raw controls and whitespace.
  if (!scheme || forbiddenSchemes.has(scheme) || /[\u0000-\u0020\u007f]/.test(template))
    return undefined;
  // oxlint-disable-next-line no-control-regex -- The host must stay a single SSH alias or hostname.
  if (!host || /[\u0000-\u0020\u007f/@:?#\\]/.test(host)) return undefined;
  const values = editorTarget(target);
  const path = values.path.replaceAll("\\", "/");
  const rootedPath = path.startsWith("/") ? path : `/${path}`;
  const replacements = {
    host: encodeURIComponent(host),
    path: rootedPath.split("/").map(encodeURIComponent).join("/"),
    pathQuery: encodeURIComponent(rootedPath),
    line: values.line,
    column: values.column,
  };
  if (/\{([^}]+)\}/g.test(template.replace(/\{(host|path|pathQuery|line|column)\}/g, "")))
    return undefined;
  const result = template.replace(
    /\{(host|path|pathQuery|line|column)\}/g,
    (_, key: keyof typeof replacements) => replacements[key],
  );
  try {
    const url = new URL(result);
    return url.username || url.password || url.protocol !== `${scheme}:` ? undefined : url.href;
  } catch {
    return undefined;
  }
}
