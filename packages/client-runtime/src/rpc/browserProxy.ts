import {
  BrowserProxyError,
  browserProxyTargetError,
  isDirectBrowserTarget,
  resolveBrowserProxyRoute,
  type PreviewOpenInput,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { request, requestGuarded } from "./client.ts";

const isBrowserProxyError = Schema.is(BrowserProxyError);

export const openWithBrowserProxy = Effect.fn("BrowserProxy.open")(function* (
  input: PreviewOpenInput,
) {
  let proxyUrl =
    input.proxyUrl === undefined
      ? undefined
      : resolveBrowserProxyRoute(input.url, input.proxyUrl, "");
  const blocked = browserProxyTargetError(input.url, proxyUrl ?? "");
  if (blocked) return yield* blocked;
  if (proxyUrl || (input.proxyUrl === undefined && !isDirectBrowserTarget(input.url))) {
    const config = yield* request(WS_METHODS.serverGetConfig, {}).pipe(
      Effect.mapError(
        () =>
          new BrowserProxyError({
            message: "Could not verify proxy support. The page was not opened.",
          }),
      ),
    );
    const saved = config.settings.browserProxy;
    proxyUrl ??= resolveBrowserProxyRoute(input.url, undefined, saved.enabled ? saved.url : "");
    if (proxyUrl && config.environment.capabilities.browserProxy !== true) {
      return yield* new BrowserProxyError({
        message:
          "This environment does not support browser proxies. Update its T3 Code server before opening this proxy tab.",
      });
    }
  }
  const blockedDefault = browserProxyTargetError(input.url, proxyUrl ?? "");
  if (blockedDefault) return yield* blockedDefault;
  const result = yield* requestGuarded(WS_METHODS.previewOpen, {
    ...input,
    ...(proxyUrl ? { proxyUrl } : {}),
  }).pipe(
    Effect.mapError((cause) =>
      proxyUrl && !isBrowserProxyError(cause)
        ? new BrowserProxyError({
            message: "The proxy tab could not be opened. Direct access was not attempted.",
          })
        : cause,
    ),
  );
  if (proxyUrl && result.proxyUrl !== proxyUrl) {
    yield* requestGuarded(WS_METHODS.previewClose, {
      threadId: input.threadId,
      tabId: result.tabId,
    }).pipe(Effect.ignore);
    return yield* new BrowserProxyError({
      message: "The environment did not confirm the requested proxy route. Do not use this tab.",
    });
  }
  return result;
});
