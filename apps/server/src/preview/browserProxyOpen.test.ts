import { describe, expect, it } from "vite-plus/test";
import { resolveBrowserProxyOpen } from "./browserProxyOpen.ts";

describe("per-request browser proxy", () => {
  it("uses the configured default and keeps ordinary tab reuse", () => {
    expect(resolveBrowserProxyOpen({}, "socks5://proxy:1080")).toEqual({ proxyUrl: "socks5://proxy:1080", reuse: true });
  });

  it("starts an independent tab for explicit proxy and direct requests", () => {
    expect(resolveBrowserProxyOpen({ proxyUrl: "http://proxy:8080" }, "")).toEqual({ proxyUrl: "http://proxy:8080", reuse: false });
    expect(resolveBrowserProxyOpen({ proxyUrl: "" }, "socks5://proxy:1080")).toEqual({ proxyUrl: "", reuse: false });
    expect(resolveBrowserProxyOpen({ proxyUrl: "", reuseExistingTab: true }, "socks5://proxy:1080").reuse).toBe(true);
    expect(resolveBrowserProxyOpen({ tabId: "tab", proxyUrl: "" }, "").reuse).toBe(true);
  });
});
