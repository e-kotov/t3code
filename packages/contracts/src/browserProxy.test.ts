import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { BrowserProxySettings, BrowserProxyUrl, normalizeBrowserProxyUrl } from "./browserProxy.ts";
import { PreviewAutomationOpenInput } from "./previewAutomation.ts";
import { ClientSettingsSchema, ClientSettingsPatch } from "./settings.ts";

describe("browser proxy configuration", () => {
  it.each([
    ["", ""],
    ["socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080"],
    ["http://PROXY.example:8080/", "http://proxy.example:8080"],
    ["https://proxy.example:443", "https://proxy.example"],
    ["socks5://[::1]:1080", "socks5://[::1]:1080"],
  ])("accepts %s without changing its route", (input, expected) => {
    expect(normalizeBrowserProxyUrl(Schema.decodeUnknownSync(BrowserProxyUrl)(input))).toBe(expected);
  });

  it.each([
    "proxy.example:8080", "file:///tmp/proxy", "socks4://proxy:1080", "http://user:password@proxy:8080",
    "http://proxy/path", "http://proxy/?secret=value", "http://proxy/#fragment", "socks5://proxy",
    "socks5://proxy:0", "socks5://proxy:65536", " http://proxy:8080", "http://proxy:8080\n", "http://pro\nxy:8080", "http://proxy,other:8080", "http:/proxy:8080",
  ])("rejects unsupported or ambiguous configuration %s", (input) => {
    expect(() => Schema.decodeUnknownSync(BrowserProxyUrl)(input)).toThrow();
  });

  it("preserves old settings and validates disabled, enabled and direct request overrides", () => {
    expect(Schema.decodeUnknownSync(ClientSettingsSchema)({}).browserProxy).toEqual({ enabled: false, url: "" });
    expect(() => Schema.decodeUnknownSync(BrowserProxySettings)({ enabled: true, url: "" })).toThrow();
    expect(Schema.decodeUnknownSync(ClientSettingsPatch)({ browserProxy: { enabled: false, url: "socks5://proxy:1080" } }).browserProxy?.url).toBe("socks5://proxy:1080");
    expect(Schema.decodeUnknownSync(PreviewAutomationOpenInput)({ proxyUrl: "" }).proxyUrl).toBe("");
  });
});
