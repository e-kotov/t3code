import {
  browserProxyRequestReuse,
  browserProxyTargetError,
  isProtectedBrowserAsset,
  isDirectBrowserTarget,
  resolveBrowserProxyRoute,
  type PreviewAutomationOpenInput,
  type PreviewAutomationRequest,
} from "@t3tools/contracts";
import { BrowserControlInterrupted } from "./SessionControl.ts";

const sameRoute = (current: string | undefined, next: string) => (current ?? "") === next;

export function browserProxyOpenInput(
  request: PreviewAutomationRequest,
): PreviewAutomationOpenInput {
  return {
    ...(request.input as PreviewAutomationOpenInput),
    ...(request.tabIdExplicit && request.tabId !== undefined ? { tabId: request.tabId } : {}),
  };
}

export function resolveBrowserProxyOpen(
  input: PreviewAutomationOpenInput,
  defaultProxyUrl: string,
  currentProxyUrl?: string,
) {
  const override = input.proxyUrl ?? (input.tabId === undefined ? undefined : currentProxyUrl);
  const proxyUrl = resolveBrowserProxyRoute(input.url, override, defaultProxyUrl);
  const blocked = browserProxyTargetError(input.url, proxyUrl);
  if (blocked) throw blocked;
  return {
    proxyUrl,
    reuse:
      browserProxyRequestReuse(input) &&
      (currentProxyUrl === undefined || sameRoute(currentProxyUrl, proxyUrl)),
  };
}

export function selectBrowserProxyTab<T extends { readonly proxyUrl: string | undefined }>(
  tab: T | undefined,
  proxyUrl: string,
  explicit: boolean,
): T | undefined {
  if (!tab || sameRoute(tab.proxyUrl, proxyUrl)) return tab;
  if (explicit)
    throw new BrowserControlInterrupted(
      "Routing is fixed for this tab. Open a new tab with proxyUrl and reuseExistingTab=false.",
    );
  return undefined;
}

export function assertBrowserProxyTarget(proxyUrl: string | undefined, url: string) {
  if (proxyUrl && (isDirectBrowserTarget(url) || isProtectedBrowserAsset(url)))
    throw new BrowserControlInterrupted(
      "Open local or app resources in a new direct tab with proxyUrl set to an empty string.",
    );
}
