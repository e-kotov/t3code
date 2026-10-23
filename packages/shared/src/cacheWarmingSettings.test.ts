import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

it("keeps cache warming off by default and merges per-thread opt-ins", () => {
  expect(DEFAULT_SERVER_SETTINGS.cacheWarmingEnabled).toBe(false);
  expect(DEFAULT_SERVER_SETTINGS.cacheWarmingSessions).toEqual({});
  const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    cacheWarmingEnabled: true,
    cacheWarmingSessions: { ["thread-a" as never]: true },
  });
  const second = applyServerSettingsPatch(first, {
    cacheWarmingSessions: { ["thread-b" as never]: true },
  });
  expect(second.cacheWarmingSessions).toEqual({ "thread-a": true, "thread-b": true });
  expect(
    applyServerSettingsPatch(second, {
      cacheWarmingSessions: { ["thread-a" as never]: false },
    }).cacheWarmingSessions,
  ).toEqual({ "thread-a": false, "thread-b": true });
});
