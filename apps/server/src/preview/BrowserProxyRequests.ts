import { isProtectedBrowserAsset } from "@t3tools/contracts";
import type { BrowserContext } from "playwright-core";

export async function guardBrowserProxyRequests(context: BrowserContext) {
  // Playwright covers initial requests, including popups, but not redirect hops.
  await context.route("**/api/assets/**", (route) =>
    isProtectedBrowserAsset(route.request().url())
      ? route.abort("blockedbyclient")
      : route.fallback(),
  );
}
