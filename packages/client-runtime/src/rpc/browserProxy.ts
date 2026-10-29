import {
  BrowserProxyError,
  browserProxyTargetError,
  resolveBrowserProxyRoute,
  type PreviewOpenInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { request, requestGuarded } from "./client.ts";

export const openWithBrowserProxy = Effect.fn("BrowserProxy.open")(function* (
  input: PreviewOpenInput,
) {
  const proxyUrl =
    input.proxyUrl === undefined
      ? undefined
      : resolveBrowserProxyRoute(input.url, input.proxyUrl, "");
  const blocked = browserProxyTargetError(input.url, proxyUrl ?? "");
  if (blocked) return yield* blocked;
  if (proxyUrl) {
    const config = yield* request(WS_METHODS.serverGetConfig, {}).pipe(
      Effect.mapError(
        () =>
          new BrowserProxyError({
            message: "Could not verify proxy support. The page was not opened.",
          }),
      ),
    );
    if (config.environment.capabilities.browserProxy !== true) {
      return yield* new BrowserProxyError({
        message:
          "This environment does not support browser proxies. Update its T3 Code server before opening this proxy tab.",
      });
    }
  }
  const result = yield* requestGuarded(WS_METHODS.previewOpen, {
    ...input,
    ...(proxyUrl === undefined ? {} : { proxyUrl }),
  });
  if (proxyUrl && result.proxyUrl !== proxyUrl) {
    yield* requestGuarded(WS_METHODS.previewClose, {
      threadId: input.threadId,
      tabId: result.tabId,
    });
    return yield* new BrowserProxyError({
      message: "The environment did not confirm the requested proxy route. The tab was closed.",
    });
  }
  return result;
});
