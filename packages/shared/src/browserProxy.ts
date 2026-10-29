import {
  BrowserProxyError,
  isProtectedBrowserAsset,
  normalizeBrowserProxyUrl,
} from "@t3tools/contracts";

import { isPrivateNetworkHost } from "./hostClassification.ts";

export function isDirectBrowserTarget(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(/^(?:https?|file):\/\//i.test(value) ? value : `http://${value}`);
    return url.protocol === "file:" || isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

export function resolveBrowserProxyRoute(
  url: string | undefined,
  override: string | undefined,
  defaultProxyUrl: string,
): string {
  if (override !== undefined) return normalizeBrowserProxyUrl(override);
  return isDirectBrowserTarget(url) ? "" : normalizeBrowserProxyUrl(defaultProxyUrl);
}

export function browserProxyTargetError(url: string | undefined, proxyUrl: string) {
  return proxyUrl && (isDirectBrowserTarget(url) || isProtectedBrowserAsset(url))
    ? new BrowserProxyError({
        message:
          'This address requires a direct tab. Turn off Browser proxy before opening a new tab, or use proxyUrl: "".',
      })
    : undefined;
}
