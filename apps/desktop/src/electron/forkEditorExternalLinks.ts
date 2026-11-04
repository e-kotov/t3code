/** Gram uses a configured SSH alias, without userinfo or a port in its path. */
export function isGramRemoteEditorUrl(url: URL): boolean {
  return url.protocol === "gram:" && url.host === "ssh" &&
    url.username.length === 0 && url.password.length === 0 &&
    /^\/[^/@:]+\/.*$/.test(url.pathname);
}
