import {
  resolveIdleCompaction,
  type IdleCompactionMode,
  type ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsPatch,
  type ThreadId,
} from "@t3tools/contracts";

export type ThreadCachePolicy = ServerSettings["threadCachePolicies"][ThreadId];
type PolicySettings = Pick<ServerSettings, "threadCachePolicies" | "cacheWarmingSessions">;

export const THREAD_CACHE_POLICIES = [
  {
    value: "default",
    label: "Default",
    description: "Use this machine’s provider settings; no warming.",
  },
  {
    value: "warm",
    label: "Keep warm",
    description: "Send visible, billable warm turns; skip automatic idle compaction.",
  },
  {
    value: "compact",
    label: "Compact before expiry",
    description:
      "Claude only, when idle with at least 200k context tokens and a known cache expiry.",
  },
  {
    value: "off",
    label: "Off",
    description: "No warm turns, idle compaction or return prompts. Manual compaction still works.",
  },
] as const;

export function threadCachePolicy(settings: PolicySettings, threadId: ThreadId): ThreadCachePolicy {
  return (
    settings.threadCachePolicies?.[threadId] ??
    (settings.cacheWarmingSessions?.[threadId] === true ? "warm" : "default")
  );
}

export function resolveThreadIdleCompaction(
  settings: ServerSettings,
  threadId: ThreadId,
  instanceId: ProviderInstanceId,
): IdleCompactionMode {
  switch (threadCachePolicy(settings, threadId)) {
    case "warm":
    case "off":
      return "off";
    case "compact":
      return "beforeCacheExpires";
    default:
      return resolveIdleCompaction(settings, instanceId);
  }
}

/** Old clients and bulk switches still write booleans. Keep both representations coherent. */
export function threadCachePolicySettingsPatch(
  current: PolicySettings,
  patch: ServerSettingsPatch,
) {
  if (patch.cacheWarmingSessions === undefined && patch.threadCachePolicies === undefined)
    return current;
  const policies: Record<string, ThreadCachePolicy> = { ...current.threadCachePolicies };
  const warming: Record<string, boolean> = { ...current.cacheWarmingSessions };
  for (const [id, enabled] of Object.entries(patch.cacheWarmingSessions ?? {})) {
    if (enabled === null) delete warming[id];
    else warming[id] = enabled;
    delete policies[id];
  }
  for (const [id, policy] of Object.entries(patch.threadCachePolicies ?? {})) {
    if (policy === null || policy === "default") delete policies[id];
    else policies[id] = policy;
    warming[id] = policy === "warm";
  }
  return { threadCachePolicies: policies, cacheWarmingSessions: warming };
}

export function cachePolicyChoices(driver: string | null | undefined) {
  return THREAD_CACHE_POLICIES.filter(
    (choice) => choice.value !== "compact" || driver === "claudeAgent",
  );
}

export const CACHE_CHIP_PATH =
  "M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM9 9h6v6H9ZM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3M19 9h3m-3 6h3";
export const CACHE_CHIP_MODIFIERS: Record<ThreadCachePolicy, string> = {
  default: "",
  warm: "M18 12c1 3-2 3-2 6a3 3 0 0 0 6 0c0-2-2-3-2-4 0 2-2 2-2 3",
  compact: "m13 13 3 3m-3 0h3v-3m6 9-3-3m0 3v-3h3",
  off: "M3 3 21 21",
};

export function cachePolicyDriver(
  settings: Pick<ServerSettings, "providerInstances">,
  instanceId: ProviderInstanceId | undefined,
  fallback?: string | null,
) {
  return (
    (instanceId === undefined
      ? undefined
      : (settings.providerInstances[instanceId]?.driver ??
        (instanceId === "codex" || instanceId === "claudeAgent" ? instanceId : fallback))) ??
    fallback
  );
}

export function legacyCacheWarmingMigration(settings: Pick<ServerSettings, "cacheWarmingInitialized" | "cacheWarmingEnabled" | "cacheWarmingSessions" | "threadCachePolicies">): ServerSettingsPatch | null {
  if (settings.cacheWarmingInitialized) return null;
  return {
    cacheWarmingInitialized: true,
    ...(!settings.cacheWarmingEnabled ? {
      cacheWarmingSessions: Object.fromEntries(Object.keys(settings.cacheWarmingSessions)
        .filter((id) => settings.threadCachePolicies[id as ThreadId] === undefined)
        .map((id) => [id, false])),
    } : {}),
  };
}
