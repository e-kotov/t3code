import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as PreviewManager from "./Manager.ts";

const layer = PreviewManager.layer.pipe(
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
