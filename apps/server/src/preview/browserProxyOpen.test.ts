import { describe, expect, it } from "vite-plus/test";
import { resolveBrowserProxyOpen } from "./browserProxyOpen.ts";

describe("per-request browser proxy", () => {
  it("uses the configured default and keeps ordinary tab reuse", () => {
    expect(resolveBrowserProxyOpen({}, "socks5://proxy:1080")).toEqual({
      proxyUrl: "socks5://proxy:1080",
      reuse: true,
    });
  });

  it("starts an independent tab for explicit proxy and direct requests", () => {
    expect(resolveBrowserProxyOpen({ proxyUrl: "http://proxy:8080" }, "")).toEqual({
      proxyUrl: "http://proxy:8080",
      reuse: false,
    });
    expect(resolveBrowserProxyOpen({ proxyUrl: "" }, "socks5://proxy:1080")).toEqual({
      proxyUrl: "",
      reuse: false,
    });
    expect(
      resolveBrowserProxyOpen({ proxyUrl: "", reuseExistingTab: true }, "socks5://proxy:1080")
        .reuse,
    ).toBe(true);
    expect(resolveBrowserProxyOpen({ tabId: "tab", proxyUrl: "" }, "").reuse).toBe(true);
  });
});

it("does not reuse a tab when the configured default route changed", () => {
  expect(resolveBrowserProxyOpen({}, "socks5://proxy:1080", "").reuse).toBe(false);
  expect(resolveBrowserProxyOpen({}, "", "socks5://proxy:1080").reuse).toBe(false);
  expect(resolveBrowserProxyOpen({}, "socks5://proxy:1080", "socks5://proxy:1080").reuse).toBe(
    true,
  );
});

it("keeps local and signed app resources direct", () => {
  const asset = `https://host.example/api/assets/cGF5bG9hZA.${"a".repeat(43)}/report.html`;
  expect(() => resolveBrowserProxyOpen({ url: asset }, "socks5://proxy:1080")).toThrow(
    "direct tab",
  );
  expect(
    resolveBrowserProxyOpen({ url: asset, proxyUrl: "" }, "socks5://proxy:1080").proxyUrl,
  ).toBe("");
  expect(
    resolveBrowserProxyOpen(
      { url: "https://external.example/api/assets/public/file" },
      "socks5://proxy:1080",
    ).proxyUrl,
  ).toBe("socks5://proxy:1080");
  for (const url of ["http://localhost:3000", "http://10.1.2.3:3000", "http://127.0.0.1:3000"]) {
    expect(resolveBrowserProxyOpen({ url }, "socks5://proxy:1080").proxyUrl).toBe("");
  }
});
