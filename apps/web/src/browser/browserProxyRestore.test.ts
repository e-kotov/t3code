import { expect, it } from "vite-plus/test";
import { type PreviewSessionSnapshot } from "@t3tools/contracts";
import { browserProxyRestoreInput } from "./browserProxyRestore";

it("restores the recorded route and runtime even after defaults change", () => {
  const snapshot = {
    proxyUrl: "socks5://old-proxy:1080",
    runtime: "server",
  } as PreviewSessionSnapshot;
  expect(browserProxyRestoreInput(snapshot)).toEqual({
    proxyUrl: "socks5://old-proxy:1080",
    runtime: "server",
  });
  expect(browserProxyRestoreInput({ runtime: "desktop" } as PreviewSessionSnapshot)).toEqual({
    runtime: "desktop",
  });
  expect(
    browserProxyRestoreInput({ proxyUrl: "", runtime: "desktop" } as PreviewSessionSnapshot),
  ).toEqual({ proxyUrl: "", runtime: "desktop" });
});
