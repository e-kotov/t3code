import { expect, it } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId, ServerSettings, ServerSettingsPatch, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { applyServerSettingsPatch } from "./serverSettings.ts";
import { cachePolicyChoices, cachePolicyDriver, resolveThreadIdleCompaction, threadCachePolicy } from "./threadCachePolicy.ts";

const id = ThreadId.make("first");
const other = ThreadId.make("other");
const instanceId = ProviderInstanceId.make("claudeAgent");

it("decodes old settings, preserves warming opt-ins and leaves previously off threads inheriting defaults", () => {
  const settings = Schema.decodeSync(ServerSettings)({ cacheWarmingSessions: { [id]: true, [other]: false } });
  expect(settings.threadCachePolicies).toEqual({});
  expect(threadCachePolicy(settings, id)).toBe("warm");
  expect(threadCachePolicy(settings, other)).toBe("default");
  expect(threadCachePolicy(DEFAULT_SERVER_SETTINGS, id)).toBe("default");
});

it.each(["onReturn", "beforeCacheExpires", "off"] as const)("applies each thread policy over global %s without changing the environment", (global) => {
  const base = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { idleCompaction: global });
  for (const [policy, expected] of [["default", global], ["warm", "off"], ["compact", "beforeCacheExpires"], ["off", "off"]] as const) {
    const settings = applyServerSettingsPatch(base, { threadCachePolicies: { [id]: policy } });
    expect(resolveThreadIdleCompaction(settings, id, instanceId)).toBe(expected);
    expect(resolveThreadIdleCompaction(settings, other, instanceId)).toBe(global);
    expect(settings.idleCompaction).toBe(global);
  }
});

it("inherits Claude instance overrides and restores them after clearing a thread override", () => {
  const base = Schema.decodeSync(ServerSettings)({ idleCompaction: "off", providerInstances: { [instanceId]: { driver: "claudeAgent", config: { idleCompaction: "beforeCacheExpires" } } } });
  expect(resolveThreadIdleCompaction(base, id, instanceId)).toBe("beforeCacheExpires");
  const off = applyServerSettingsPatch(base, { threadCachePolicies: { [id]: "off", [other]: "compact" } });
  expect(resolveThreadIdleCompaction(off, id, instanceId)).toBe("off");
  const reset = applyServerSettingsPatch(off, { threadCachePolicies: { [id]: null } });
  expect(resolveThreadIdleCompaction(reset, id, instanceId)).toBe("beforeCacheExpires");
  expect(threadCachePolicy(reset, other)).toBe("compact");
});

it("keeps legacy clients and bulk switches coherent with the new choices, with explicit policy taking precedence", () => {
  let settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { threadCachePolicies: { [id]: "warm", [other]: "off" } });
  expect(settings.cacheWarmingSessions[id]).toBe(true);
  settings = applyServerSettingsPatch(settings, { cacheWarmingSessions: { [id]: false } });
  expect(threadCachePolicy(settings, id)).toBe("default");
  expect(threadCachePolicy(settings, other)).toBe("off");
  settings = applyServerSettingsPatch(settings, { cacheWarmingSessions: { [id]: true }, threadCachePolicies: { [id]: "compact" } });
  expect(threadCachePolicy(settings, id)).toBe("compact");
  expect(settings.cacheWarmingSessions[id]).toBe(false);
  settings = applyServerSettingsPatch(settings, { threadCachePolicies: { [id]: "default" } });
  expect(threadCachePolicy(settings, id)).toBe("default");
  expect(settings.threadCachePolicies[id]).toBeUndefined();
});

it("rejects unknown policies and does not offer Claude compaction to Codex", () => {
  expect(() => Schema.decodeUnknownSync(ServerSettingsPatch)({ threadCachePolicies: { [id]: "always" } })).toThrow();
  expect(cachePolicyChoices("codex").map((choice) => choice.value)).toEqual(["default", "warm", "off"]);
  expect(cachePolicyChoices("claudeAgent").map((choice) => choice.value)).toEqual(["default", "warm", "compact", "off"]);
  expect(cachePolicyDriver(DEFAULT_SERVER_SETTINGS, instanceId)).toBe("claudeAgent");
});
