import {
  globalIdleCompaction,
  resolveIdleCompaction,
  withIdleCompaction,
  type IdleCompactionMode,
  type MessageId,
  type ProviderInstanceConfig,
  ProviderInstanceId,
  type ServerSettings,
  type ServerSettingsPatch,
  type ThreadId,
} from "@t3tools/contracts";
import { COMPACTION_SUGGESTION_MIN_TOKENS } from "./claudeCompaction.ts";

export type ThreadCachePolicy = ServerSettings["threadCachePolicies"][ThreadId];
type PolicySettings = Pick<ServerSettings, "threadCachePolicies" | "cacheWarmingSessions">;
export type MachineIdlePolicy = NonNullable<ServerSettings["machineIdlePolicy"]>;
export type IdleThreadProvider = Exclude<keyof MachineIdlePolicy, "mode">;
export const IDLE_THREAD_PROVIDERS = [
  { driver: "claudeAgent", label: "Claude" },
  { driver: "codex", label: "Codex" },
  { driver: "antigravity", label: "Antigravity" },
] as const satisfies ReadonlyArray<{ driver: IdleThreadProvider; label: string }>;

export const MACHINE_IDLE_COMPACTION_MESSAGE_PREFIX = "idle-compact:machine:";

export function isIdleMaintenanceMessageId(messageId: MessageId): boolean {
  return messageId.startsWith("idle-compact:") || messageId.startsWith("message:cache-warm:");
}

export function showIdleCompactionPlaceholder(messageId: MessageId, active: boolean): boolean {
  return active || !messageId.startsWith(MACHINE_IDLE_COMPACTION_MESSAGE_PREFIX);
}

export function isIdleThreadProvider(driver: string): driver is IdleThreadProvider {
  return IDLE_THREAD_PROVIDERS.some((entry) => entry.driver === driver);
}

export function machineIdlePolicy(settings: ServerSettings): MachineIdlePolicy {
  return (
    settings.machineIdlePolicy ?? {
      mode: globalIdleCompaction(settings) === "beforeCacheExpires" ? "compact" : "off",
      claudeAgent: { idleMinutes: 55, minContextTokens: COMPACTION_SUGGESTION_MIN_TOKENS },
      codex: {
        idleMinutes: settings.codexCacheWarmAfterMinutes,
        minContextTokens: COMPACTION_SUGGESTION_MIN_TOKENS,
      },
      antigravity: {
        idleMinutes:
          settings.neonCacheWarmAfterMinutes === 50 ? 55 : settings.neonCacheWarmAfterMinutes,
        minContextTokens: COMPACTION_SUGGESTION_MIN_TOKENS,
      },
    }
  );
}

export function effectiveLegacyIdleSettings(settings: ServerSettings): ServerSettings {
  if (settings.machineIdlePolicy === undefined) return settings;
  const providerInstances = { ...settings.providerInstances };
  for (const [key, instance] of Object.entries(providerInstances)) {
    if (
      instance.driver !== "claudeAgent" ||
      typeof instance.config !== "object" ||
      instance.config === null ||
      Array.isArray(instance.config)
    )
      continue;
    const config = instance.config as Record<string, unknown>;
    if (config.idleCompaction === undefined || config.idleCompaction === "off") continue;
    providerInstances[ProviderInstanceId.make(key)] = {
      ...instance,
      config: { ...config, idleCompaction: "off" },
    };
  }
  return {
    ...withIdleCompaction(settings, "off"),
    providerInstances,
    threadCachePolicies: {},
    cacheWarmingSessions: {},
  };
}

/** Older clients echo the inactive mode when saving an unrelated Claude instance edit. */
export function preserveEchoedIdleCompaction(
  stored: ProviderInstanceConfig | undefined,
  instance: ProviderInstanceConfig,
): ProviderInstanceConfig {
  if (
    instance.driver !== "claudeAgent" ||
    (stored !== undefined && stored.driver !== instance.driver) ||
    typeof instance.config !== "object" ||
    instance.config === null ||
    !("idleCompaction" in instance.config) ||
    instance.config.idleCompaction !== "off"
  )
    return instance;
  const { idleCompaction: _echoed, ...config } = instance.config;
  const previous = stored?.config;
  return {
    ...instance,
    config:
      typeof previous === "object" && previous !== null && "idleCompaction" in previous
        ? { ...config, idleCompaction: previous.idleCompaction }
        : config,
  };
}

export function cacheWarmingEnabled(settings: ServerSettings, threadId: ThreadId): boolean {
  return settings.machineIdlePolicy === undefined
    ? threadCachePolicy(settings, threadId) === "warm"
    : settings.machineIdlePolicy.mode === "warm";
}

const THREAD_CACHE_POLICIES = [
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
  if (settings.machineIdlePolicy !== undefined) {
    return settings.machineIdlePolicy.mode === "compact" ? "beforeCacheExpires" : "off";
  }
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
  current: ServerSettings,
  patch: ServerSettingsPatch,
) {
  const idlePatch = patch.machineIdlePolicy;
  const idle = machineIdlePolicy(current);
  const machinePatch =
    idlePatch === undefined
      ? {}
      : {
          machineIdlePolicy: {
            mode: idlePatch.mode ?? idle.mode,
            claudeAgent: { ...idle.claudeAgent, ...idlePatch.claudeAgent },
            codex: { ...idle.codex, ...idlePatch.codex },
            antigravity: { ...idle.antigravity, ...idlePatch.antigravity },
          },
        };
  if (patch.cacheWarmingSessions === undefined && patch.threadCachePolicies === undefined)
    return {
      ...machinePatch,
      threadCachePolicies: current.threadCachePolicies,
      cacheWarmingSessions: current.cacheWarmingSessions,
    };
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
  return { ...machinePatch, threadCachePolicies: policies, cacheWarmingSessions: warming };
}

export function isNeonCacheModel(model: string | undefined): boolean {
  return model !== undefined && /^gemini-4-neon(?:-(?:low|medium|high|xhigh))?$/.test(model);
}

export function supportsThreadCachePolicy(
  driver: string | null | undefined,
  model?: string,
  neonCacheWarming?: boolean,
): boolean {
  return (
    driver === "codex" ||
    driver === "claudeAgent" ||
    (driver === "antigravity" && neonCacheWarming === true && isNeonCacheModel(model))
  );
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
        (instanceId === "codex" || instanceId === "claudeAgent" || instanceId === "antigravity"
          ? instanceId
          : fallback))) ?? fallback
  );
}

export function legacyCacheWarmingMigration(
  settings: Pick<
    ServerSettings,
    | "cacheWarmingInitialized"
    | "cacheWarmingEnabled"
    | "cacheWarmingSessions"
    | "threadCachePolicies"
  >,
): ServerSettingsPatch | null {
  if (settings.cacheWarmingInitialized) return null;
  return {
    cacheWarmingInitialized: true,
    ...(!settings.cacheWarmingEnabled
      ? {
          cacheWarmingSessions: Object.fromEntries(
            Object.keys(settings.cacheWarmingSessions)
              .filter((id) => settings.threadCachePolicies[id as ThreadId] === undefined)
              .map((id) => [id, false]),
          ),
        }
      : {}),
  };
}

const CACHE_CHIP_FRAME = "M0 0H24V24H0Z";
const CACHE_CHIP_BADGE = "M12 18a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z";
export const CACHE_CHIP_CLIPS: Record<ThreadCachePolicy, string> = {
  default: CACHE_CHIP_FRAME,
  warm: CACHE_CHIP_FRAME + CACHE_CHIP_BADGE,
  compact: CACHE_CHIP_FRAME + CACHE_CHIP_BADGE,
  off: CACHE_CHIP_FRAME + "M1.4 4.6 4.6 1.4 22.6 19.4 19.4 22.6Z",
};
