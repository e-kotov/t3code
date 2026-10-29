import { normalizeBrowserProxyUrl } from "@t3tools/contracts";

export function browserProxyLaunchOptions(proxyUrl?: string) {
  const server = normalizeBrowserProxyUrl(proxyUrl ?? "");
  return server ? { proxy: { server, bypass: "localhost,127.0.0.1,[::1]" } } : {};
}

