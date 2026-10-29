import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as PreviewManager from "./Manager.ts";
import * as ProxyManager from "./BrowserProxyManager.ts";
import * as ProxySettings from "../serverSettings.ts";
import * as PreviewBrowser from "./PreviewBrowser.ts";
import * as Option from "effect/Option";

const layer = ProxyManager.layer.pipe(
  Layer.provideMerge(ProxySettings.ServerSettings.layerTest()),
  Layer.provide(Layer.succeed(PreviewBrowser.PreviewBrowser, { executable: Effect.succeed("/fixture/chrome"), installed: Effect.succeed(Option.none()) })),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-proxy-manager-" })),
  Layer.provide(NodeCrypto.layer),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("proxy tab ownership", (it) => {
  it.effect("forces proxy tabs onto the server and keeps their route through navigation", () =>
    Effect.gen(function* () {
      const manager = yield* PreviewManager.PreviewManager;
      const threadId = ThreadId.make("proxy-thread");
      const proxyUrl = "socks5://127.0.0.1:1080";
      const settings = yield* ProxySettings.ServerSettings;
      yield* settings.updateSettings({ browserProxy: { enabled: true, url: proxyUrl } });
      const scheduled = yield* manager.open({ threadId, url: "https://example.com" });
      expect(scheduled.proxyUrl).toBe(proxyUrl);
      const local = yield* manager.open({ threadId, runtime: "desktop", url: "https://host.example/api/assets/private-token/report.html", proxyUrl: "" });
      expect(local.runtime).toBe("desktop");
      expect(local.proxyUrl).toBe("");
      const inherited = yield* manager.open({ threadId, url: "http://localhost:3000", proxyUrl });
      expect(inherited.proxyUrl).toBe(proxyUrl);
      const opened = yield* manager.open({ threadId, runtime: "desktop", proxyUrl });
      expect(opened.runtime).toBe("server");
      expect(opened.headless).toBe(true);
      yield* manager.reportStatus({
        threadId,
        tabId: opened.tabId,
        serverControlled: true,
        navStatus: { _tag: "Success", url: "https://example.com/", title: "Page" },
        canGoBack: false,
        canGoForward: false,
      });
      const listed = yield* manager.list({ threadId });
      expect(listed.sessions.find((tab) => tab.tabId === opened.tabId)?.proxyUrl).toBe(proxyUrl);
      const direct = yield* manager.open({ threadId, proxyUrl: "", runtime: "desktop" });
      expect(direct.runtime).toBe("desktop");
      expect(direct.headless).toBeUndefined();
      expect(direct.proxyUrl).toBe("");
    }),
  );
});


it.effect("rejects unsupported proxy hosts before publishing a tab", () => Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const threadId = ThreadId.make("unsupported");
  const result = yield* manager.open({ threadId, url: "https://example.com", proxyUrl: "socks5://proxy:1080" }).pipe(Effect.result);
  expect(result._tag).toBe("Failure");
  expect((yield* manager.list({ threadId })).sessions).toEqual([]);
}).pipe(Effect.provide(ProxyManager.layer.pipe(
  Layer.provide(ProxySettings.ServerSettings.layerTest()),
  Layer.provide(Layer.succeed(PreviewBrowser.PreviewBrowser, { executable: Effect.fail(new PreviewBrowser.PreviewBrowserUnsupportedError({ platform: "android", arch: "arm64" })), installed: Effect.succeed(Option.none()) })),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-proxy-unsupported-" })),
  Layer.provide(NodeCrypto.layer), Layer.provide(NodeServices.layer),
))));
