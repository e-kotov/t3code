import type { ExpoConfig } from "expo/config";
import { expect, it } from "vite-plus/test";
import { withForkAppIdentity } from "./fork-app-identity";

const config: ExpoConfig = { name: "T3 Code", slug: "t3-code", version: "future-upstream-version", scheme: "t3code-preview", extra: { future: true } };

it("retains upstream scheme and version for ordinary builds", () => {
  expect(withForkAppIdentity(config, false, "fork-version")).toBe(config);
});
it("overrides fork identity without depending on the upstream version line", () => {
  expect(withForkAppIdentity(config, true, "0.1.2-ek.1")).toEqual({ ...config, scheme: "t3code-ek", version: "0.1.2-ek.1" });
  expect(withForkAppIdentity(config, true).version).toBe("0.0.45");
  expect(config.version).toBe("future-upstream-version");
});
