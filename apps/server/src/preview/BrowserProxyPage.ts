import { isProtectedBrowserAsset, type PreviewSessionSnapshot } from "@t3tools/contracts";
import type { BrowserContext, Page } from "playwright-core";
import type { BrowserProxyContexts } from "./BrowserProxyContexts.ts";

export async function acquireBrowserProxyPage(input: {
  readonly contexts: BrowserProxyContexts;
  readonly snapshot: PreviewSessionSnapshot;
  readonly isolationKey: string | undefined;
  readonly adopted?: Page;
  readonly desktop?: Page;
  readonly prepare: (context: BrowserContext) => Promise<void>;
}) {
  if (input.adopted) {
    if (input.adopted.isClosed()) throw new Error("The popup closed before it opened.");
    const context = input.adopted.context();
    await input.prepare(context);
    return { context, page: input.adopted };
  }
  if (input.desktop) return { context: input.desktop.context(), page: input.desktop };
  return input.contexts.pageFor(
    input.snapshot.profileId ?? "default",
    input.isolationKey,
    input.snapshot.proxyUrl,
    input.prepare,
  );
}

export async function closeProtectedBrowserPopup(proxyUrl: string | undefined, popup: Page) {
  if (!proxyUrl || !isProtectedBrowserAsset(popup.url())) return false;
  await popup.close();
  return true;
}
