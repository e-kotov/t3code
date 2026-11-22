import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

it("keeps cache warming off by default and merges per-thread opt-ins", () => {
  expect(DEFAULT_SERVER_SETTINGS.cacheWarmingEnabled).toBe(false);
  expect(DEFAULT_SERVER_SETTINGS.cacheWarmingSessions).toEqual({});
  expect(DEFAULT_SERVER_SETTINGS.codexCacheWarmAfterMinutes).toBe(115);
  expect(DEFAULT_SERVER_SETTINGS.neonCacheWarmAfterMinutes).toBe(50);
  const warmAfter = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    codexCacheWarmAfterMinutes: 55,
    neonCacheWarmAfterMinutes: 40,
  });
  expect(warmAfter.codexCacheWarmAfterMinutes).toBe(55);
  expect(warmAfter.neonCacheWarmAfterMinutes).toBe(40);
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

it("keeps machine policy patches independent and leaves legacy servers unconfigured", () => {
  expect(DEFAULT_SERVER_SETTINGS.machineIdlePolicy).toBeUndefined();
  const compact = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    machineIdlePolicy: { mode: "compact" },
  });
  expect(compact.machineIdlePolicy).toEqual({
    mode: "compact",
    claudeAgent: { idleMinutes: 55, minContextTokens: 200_000 },
    codex: { idleMinutes: 115, minContextTokens: 200_000 },
    antigravity: { idleMinutes: 55, minContextTokens: 200_000 },
  });
  const tuned = applyServerSettingsPatch(compact, {
    machineIdlePolicy: { codex: { idleMinutes: 60 } },
  });
  const lowered = applyServerSettingsPatch(tuned, {
    machineIdlePolicy: { codex: { minContextTokens: 50_000 } },
  });
  const off = applyServerSettingsPatch(lowered, { machineIdlePolicy: { mode: "off" } });
  expect(off.machineIdlePolicy).toEqual({
    ...compact.machineIdlePolicy,
    mode: "off",
    codex: { idleMinutes: 60, minContextTokens: 50_000 },
  });
});
