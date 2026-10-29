import { BrowserProxyError, browserProxyTargetError, resolveBrowserProxyRoute } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as PreviewBrowser from "./PreviewBrowser.ts";
import * as PreviewManager from "./Manager.ts";

const make = Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const settings = yield* ServerSettings.ServerSettings;
  const browser = yield* PreviewBrowser.PreviewBrowser;
  return PreviewManager.PreviewManager.of({
    ...manager,
    open: Effect.fn("BrowserProxyManager.open")(function* (input) {
      const current = yield* settings.getSettings.pipe(Effect.mapError(() => new BrowserProxyError({ message: "Could not read the environment's browser proxy settings." })));
      const proxyUrl = resolveBrowserProxyRoute(input.url, input.proxyUrl, current.browserProxy.enabled ? current.browserProxy.url : "");
      const blocked = browserProxyTargetError(input.url, proxyUrl);
      if (blocked) return yield* blocked;
      if (proxyUrl) {
        yield* browser.executable.pipe(Effect.mapError((cause) => new BrowserProxyError({ message: `Proxy browsing is unavailable on this environment. ${cause.message}` })));
      }
      return yield* manager.open({ ...input, proxyUrl });
    }),
  });
});

export const layer = Layer.effect(PreviewManager.PreviewManager, make).pipe(Layer.provide(PreviewManager.layer));
