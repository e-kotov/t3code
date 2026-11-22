import type {
  ModelSelection,
  OrchestrationV2CacheHud,
  OrchestrationV2ProviderTurnTokenUsage,
  OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  ServerProviderUsageWindow,
  ThreadId,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { isNeonCacheModel } from "./threadCachePolicy.ts";
import { formatResetsIn } from "./usageLimitsCopy.ts";

// A user-selected freshness estimate, not a provider-reported retention guarantee.
const CODEX_BASELINE_MS = 60 * 60_000;
export const CODEX_WARM_MARGIN_MS = 5 * 60_000;
const NEON_CACHE_ESTIMATE_MS = 60 * 60_000;
export const NEON_WARM_MARGIN_MS = 5 * 60_000;
export const LEGACY_CODEX_CACHE_WARM_AFTER_MINUTES = 55;

export interface CodexCacheWarmConfig {
  readonly environment?:
    | {
        readonly capabilities?:
          | {
              readonly codexCacheWarmAfter?: boolean | undefined;
            }
          | null
          | undefined;
      }
    | null
    | undefined;
  readonly settings?:
    | {
        readonly codexCacheWarmAfterMinutes: number;
      }
    | null
    | undefined;
}

/** Whether a connected server honors `codexCacheWarmAfterMinutes` instead of 55 minutes. */
export function supportsCodexCacheWarmAfter(
  config: CodexCacheWarmConfig | null | undefined,
): boolean {
  return config?.environment?.capabilities?.codexCacheWarmAfter === true;
}

/** Effective Codex warm interval for a server, falling back to 55 min on older servers. */
export function resolveCodexCacheWarmAfterMinutes(
  config: CodexCacheWarmConfig | null | undefined,
): number {
  return supportsCodexCacheWarmAfter(config) && config?.settings
    ? config.settings.codexCacheWarmAfterMinutes
    : LEGACY_CODEX_CACHE_WARM_AFTER_MINUTES;
}

interface NeonCacheWarmConfig {
  readonly environment?:
    | {
        readonly capabilities?: { readonly neonCacheWarming?: boolean | undefined } | undefined;
      }
    | null
    | undefined;
  readonly settings?: { readonly neonCacheWarmAfterMinutes: number } | null | undefined;
}

export function supportsNeonCacheWarming(config: NeonCacheWarmConfig | null | undefined): boolean {
  return config?.environment?.capabilities?.neonCacheWarming === true;
}

export function resolveNeonCacheWarmAfterMinutes(config: NeonCacheWarmConfig | null | undefined) {
  return supportsNeonCacheWarming(config) ? config?.settings?.neonCacheWarmAfterMinutes : undefined;
}

export function cacheHudSupportsWarming(hud: OrchestrationV2CacheHud | null | undefined): boolean {
  return (
    hud?.driver === "codex" ||
    hud?.driver === "claudeAgent" ||
    (hud?.driver === "antigravity" && hud.basis === "estimated")
  );
}

/** Estimated providers accept warm turns for five minutes after the selected idle time. */
export function cacheWarmWindowMs(
  hud: OrchestrationV2CacheHud,
  codexWarmAfterMinutes: number,
  neonWarmAfterMinutes?: number,
) {
  if (!cacheHudSupportsWarming(hud)) return undefined;
  if (hud.basis === "estimated") {
    if (hud.driver === "codex") return codexWarmAfterMinutes * 60_000 + CODEX_WARM_MARGIN_MS;
    if (hud.driver === "antigravity") {
      return neonWarmAfterMinutes === undefined
        ? undefined
        : neonWarmAfterMinutes * 60_000 + NEON_WARM_MARGIN_MS;
    }
  }
  return hud.ttlMs;
}

/** Derive one compact server-owned summary, not transcript data, for every client. */
export function deriveCacheHud(
  driver: ProviderDriverKind,
  reports: ReadonlyArray<OrchestrationV2ProviderTurnTokenUsage>,
  modelSelection: ModelSelection,
): OrchestrationV2CacheHud | null {
  const scope = `${modelSelection.instanceId}:${modelSelection.model}`;
  const recent = [...reports]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .slice(-64)
    .filter(
      (report) =>
        Number.isFinite(Date.parse(report.updatedAt)) &&
        (report.cacheScopeKey === undefined || report.cacheScopeKey === scope),
    );
  const meaningful = recent.filter(
    (report) =>
      (report.inputTokens ?? 0) > 0 ||
      (report.cachedInputTokens ?? 0) > 0 ||
      (report.cacheCreationTokens ?? 0) > 0 ||
      (report.inputTokens === undefined && report.usedTokens > 0),
  );
  const request = meaningful.at(-1);
  // Codex reports the compacted context with zero request counters. Its size is
  // current, but those zeros neither describe a cache miss nor refresh its clock.
  const context = recent.findLast((report) => report.usedTokens > 0) ?? request;
  if (!context) return null;
  if (!request) {
    return {
      driver,
      usage: {
        usedTokens: context.usedTokens,
        ...(context.maxTokens === undefined ? {} : { maxTokens: context.maxTokens }),
        updatedAt: context.updatedAt,
      },
      basis: "unknown",
    };
  }
  const usage =
    context === request
      ? request
      : {
          ...request,
          usedTokens: context.usedTokens,
          ...(context.maxTokens === undefined ? {} : { maxTokens: context.maxTokens }),
        };
  if (driver === "claudeAgent") {
    // A cache-only read refreshes the lifetime previously written by this
    // provider thread. Persisted reports retain it across process restarts.
    const reported = meaningful.findLast(
      (report) => report.promptCacheTtlMs !== undefined,
    )?.promptCacheTtlMs;
    return reported === undefined
      ? { driver, usage, basis: "unknown" }
      : { driver, usage, ttlMs: reported, basis: "reported" };
  }
  if (driver === "codex") return { driver, usage, ttlMs: CODEX_BASELINE_MS, basis: "estimated" };
  if (
    driver === "antigravity" &&
    isNeonCacheModel(modelSelection.model) &&
    request.cacheScopeKey === scope
  ) {
    return { driver, usage, ttlMs: NEON_CACHE_ESTIMATE_MS, basis: "estimated" };
  }
  return { driver, usage, basis: "unknown" };
}

export function reportFromContextUsage(
  contextUsage: ThreadTokenUsageSnapshot,
  updatedAt: string,
): OrchestrationV2ProviderTurnTokenUsage {
  return {
    usedTokens: contextUsage.usedTokens,
    ...(contextUsage.maxTokens !== undefined ? { maxTokens: contextUsage.maxTokens } : {}),
    ...(contextUsage.inputTokens !== undefined ? { inputTokens: contextUsage.inputTokens } : {}),
    ...(contextUsage.cachedInputTokens !== undefined
      ? { cachedInputTokens: contextUsage.cachedInputTokens }
      : {}),
    updatedAt,
  };
}

// Focused subagent usage arrives through the detail stream, bypassing shell refreshes.
export function focusedCacheHud(
  fallback: OrchestrationV2CacheHud | null | undefined,
  projection:
    | {
        readonly thread: Pick<
          OrchestrationV2ThreadProjection["thread"],
          "activeProviderThreadId" | "modelSelection"
        >;
        readonly providerThreads: ReadonlyArray<
          Pick<OrchestrationV2ThreadProjection["providerThreads"][number], "id" | "driver"> & {
            readonly contextUsage?: OrchestrationV2ThreadProjection["providerThreads"][number]["contextUsage"];
            readonly updatedAt?: OrchestrationV2ThreadProjection["providerThreads"][number]["updatedAt"];
          }
        >;
        readonly providerTurns: ReadonlyArray<
          Pick<
            OrchestrationV2ThreadProjection["providerTurns"][number],
            "providerThreadId" | "tokenUsage"
          >
        >;
      }
    | null
    | undefined,
): OrchestrationV2CacheHud | null {
  if (!projection) return fallback ?? null;
  const provider = projection.providerThreads.find(
    (entry) => entry.id === projection.thread.activeProviderThreadId,
  );
  if (!provider) return null;
  const turnReports = projection.providerTurns
    .filter((turn) => turn.providerThreadId === provider.id)
    .flatMap((turn) => (turn.tokenUsage ? [turn.tokenUsage] : []));
  const reports =
    turnReports.length > 0
      ? turnReports
      : provider.contextUsage && provider.updatedAt
        ? [reportFromContextUsage(provider.contextUsage, DateTime.formatIso(provider.updatedAt))]
        : [];
  return deriveCacheHud(provider.driver, reports, projection.thread.modelSelection);
}

function formatHudTokens(value: number) {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value / 1_000_000)}m`;
}

export function presentCacheHud(hud: OrchestrationV2CacheHud, nowMs: number) {
  const { usage } = hud;
  const cached = usage.cachedInputTokens;
  const remainingMs =
    hud.ttlMs === undefined ? null : Math.max(0, Date.parse(usage.updatedAt) + hud.ttlMs - nowMs);
  const observedCold = cached === 0 && (usage.cacheCreationTokens ?? 0) === 0;
  const estimateElapsed = hud.basis === "estimated" && remainingMs === 0;
  const state = observedCold
    ? "cold"
    : estimateElapsed ||
        remainingMs === null ||
        (cached === undefined && !usage.cacheCreationTokens)
      ? "unknown"
      : remainingMs === 0
        ? "cold"
        : remainingMs <= 300_000
          ? "expiring"
          : "hot";
  const percentage =
    usage.inputTokens && cached !== undefined
      ? Math.min(100, Math.round((cached / usage.inputTokens) * 100))
      : null;
  // @effect-diagnostics-next-line globalDate:off -- Format the React HUD in the device local timezone.
  const expiry = new Date(Date.parse(usage.updatedAt) + (hud.ttlMs ?? 0));
  const clock = `${String(expiry.getHours()).padStart(2, "0")}:${String(expiry.getMinutes()).padStart(2, "0")}`;
  const tokens = cached === undefined ? "⇣?" : `⇣${formatHudTokens(cached)}`;
  const cacheText =
    state === "cold"
      ? `❄ ${tokens}`
      : state === "unknown"
        ? `? ${percentage === null ? "" : `${percentage}% `}${tokens}`
        : `${state === "expiring" ? "⏰ " : ""}~${clock} ${percentage === null ? "" : `${percentage}% `}${tokens}`;
  const max = usage.maxTokens;
  const contextText = `${formatHudTokens(usage.usedTokens)}/${max ? formatHudTokens(max) : "?"}`;
  const contextPercentage = max ? Math.min(100, Math.round((usage.usedTokens / max) * 100)) : null;
  const description = `Context tokens: ${usage.usedTokens}/${max ?? "unknown"}${contextPercentage === null ? "" : ` (${contextPercentage}%)`}. Last-request cached tokens: ${cached ?? "unknown"}${percentage === null ? "" : ` (${percentage}%)`}.${usage.cacheCreationTokens === undefined ? "" : ` Cache-write tokens: ${usage.cacheCreationTokens}.`} Cache expiry${remainingMs === null ? "" : ` at ${clock} (device local time)`} is an estimate${hud.basis === "reported" ? " based on Claude's reported lifetime" : hud.basis === "estimated" ? " using an assumed one-hour window" : "; lifetime is unknown"}. Prefix changes and eviction can make it cold earlier.`;
  return { state, cacheText, contextText, contextPercentage, description, remainingMs };
}

function formatRemaining(ms: number) {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** Spelled-out cache, last-request and context lines for hover cards; the
 * compact HUD shows the same facts as `~09:36 100% ⇣123k`. */
export function describeCacheHud(hud: OrchestrationV2CacheHud, nowMs: number) {
  const view = presentCacheHud(hud, nowMs);
  const { usage } = hud;
  // @effect-diagnostics-next-line globalDate:off -- Format the hover card in the device local timezone.
  const expiry = new Date(Date.parse(usage.updatedAt) + (hud.ttlMs ?? 0));
  const clock = `${String(expiry.getHours()).padStart(2, "0")}:${String(expiry.getMinutes()).padStart(2, "0")}`;
  const cache =
    view.state === "unknown"
      ? view.remainingMs === 0
        ? "Cache status unknown · estimate elapsed"
        : "Cache lifetime unknown"
      : view.state === "cold"
        ? view.remainingMs === 0 && hud.basis === "reported"
          ? `Cache expired at ~${clock}`
          : "Cache missed on the last request"
        : `Cache until ~${clock} · ${formatRemaining(view.remainingMs ?? 0)} left${hud.basis === "estimated" ? " (estimate)" : ""}`;
  const cached = usage.cachedInputTokens;
  const hitPercentage =
    usage.inputTokens && cached !== undefined
      ? Math.min(100, Math.round((cached / usage.inputTokens) * 100))
      : null;
  const written = usage.cacheCreationTokens
    ? ` · ${formatHudTokens(usage.cacheCreationTokens)} written`
    : "";
  const lastRequest =
    cached === undefined
      ? null
      : hitPercentage === null
        ? `Last request: ${formatHudTokens(cached)} from cache${written}`
        : `Last request: ${hitPercentage}% from cache (${formatHudTokens(cached)})${written}`;
  const context = usage.maxTokens
    ? `Context ${formatHudTokens(usage.usedTokens)} of ${formatHudTokens(usage.maxTokens)} · ${view.contextPercentage}%`
    : `Context ${formatHudTokens(usage.usedTokens)}`;
  return { state: view.state, cache, lastRequest, context };
}

/** Spelled-out subscription limits for hover cards, e.g.
 * `5-hour limit: 98% left · resets in 2h 21m` and `Weekly · Fable: 93% left`. */
export function describeUsageWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow> | undefined,
  nowMs: number,
) {
  return (windows ?? [])
    .filter((window) => window.kind === "session" || window.kind === "weekly")
    .map((window) => {
      const label =
        window.kind === "session" && window.windowDurationMins === 300
          ? "5-hour limit"
          : window.label;
      const remaining = Math.max(0, 100 - Math.round(window.usedPercent));
      const resets = formatResetsIn(window, nowMs);
      return {
        id: window.id,
        text: `${label}: ${remaining}% left${resets ? ` · ${resets.toLowerCase()}` : ""}`,
      };
    });
}

function threadWarmWindowMs(
  thread: {
    readonly cacheHud?: OrchestrationV2CacheHud | null | undefined;
    readonly archivedAt: string | null;
  },
  codexWarmAfterMinutes: number,
  neonWarmAfterMinutes?: number,
): { readonly updatedAtMs: number; readonly windowMs: number } | null {
  const hud = thread.cacheHud;
  const windowMs = hud
    ? cacheWarmWindowMs(hud, codexWarmAfterMinutes, neonWarmAfterMinutes)
    : undefined;
  if (
    thread.archivedAt !== null ||
    !hud ||
    (hud.usage.cachedInputTokens ?? 0) + (hud.usage.cacheCreationTokens ?? 0) <= 0 ||
    windowMs === undefined
  ) {
    return null;
  }
  const updatedAtMs = Date.parse(hud.usage.updatedAt);
  return Number.isFinite(updatedAtMs) ? { updatedAtMs, windowMs } : null;
}

/** Conversations inside a supported warm window whose last request reused or wrote cache. */
export function hotCacheThreadIds(
  threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly cacheHud?: OrchestrationV2CacheHud | null | undefined;
    readonly archivedAt: string | null;
  }>,
  nowMs: number,
  codexWarmAfterMinutes: number,
  neonWarmAfterMinutes?: number,
): ThreadId[] {
  return threads
    .filter((thread) => {
      const window = threadWarmWindowMs(thread, codexWarmAfterMinutes, neonWarmAfterMinutes);
      return window !== null && nowMs - window.updatedAtMs < window.windowMs;
    })
    .map((thread) => thread.id);
}

/** Earliest future cache-warm expiry (`> afterMs`) among eligible warm threads. */
export function nextCacheWarmExpiry(
  threads: ReadonlyArray<{
    readonly cacheHud?: OrchestrationV2CacheHud | null | undefined;
    readonly archivedAt: string | null;
  }>,
  afterMs: number,
  codexWarmAfterMinutes: number,
  neonWarmAfterMinutes?: number,
): number | null {
  let earliest: number | null = null;
  for (const thread of threads) {
    const window = threadWarmWindowMs(thread, codexWarmAfterMinutes, neonWarmAfterMinutes);
    if (window === null) continue;
    const expiry = window.updatedAtMs + window.windowMs;
    if (Number.isFinite(expiry) && expiry > afterMs && (earliest === null || expiry < earliest)) {
      earliest = expiry;
    }
  }
  return earliest;
}

/** Whether warming is on for all, none or some of the given conversations. */
export function cacheWarmingState(
  threadIds: ReadonlyArray<ThreadId>,
  sessions: Readonly<Record<string, boolean>> | undefined,
): "on" | "off" | "mixed" {
  const enabledCount = threadIds.filter((id) => sessions?.[id] === true).length;
  if (enabledCount === 0) return "off";
  return enabledCount === threadIds.length ? "on" : "mixed";
}

/** One timer per surface, waking only at the warning and expiry boundaries. */
export function createCacheHudClock(
  isActive: () => boolean,
  observeActivity: (refresh: () => void) => () => void,
) {
  const listeners = new Map<() => void, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopObserving: (() => void) | undefined;
  const nextWake = (expiry: number, now: number) =>
    expiry - 300_000 > now ? expiry - 300_000 : expiry > now ? expiry : null;
  function schedule() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!isActive()) return;
    // @effect-diagnostics-next-line globalDate:off -- React external-store boundaries use wall-clock milliseconds.
    const now = Date.now();
    let earliest = Infinity;
    for (const expiry of listeners.values()) {
      const wake = nextWake(expiry, now);
      if (wake !== null) earliest = Math.min(earliest, wake);
    }
    if (Number.isFinite(earliest)) {
      // @effect-diagnostics-next-line globalTimers:off -- One foreground timer feeds synchronous React external-store subscribers.
      timer = setTimeout(
        () => {
          // Snapshots are stable phases; only rows crossing a boundary redraw.
          for (const listener of listeners.keys()) listener();
          schedule();
        },
        Math.min(earliest - now, 2_147_483_647),
      );
    }
  }
  function refresh() {
    for (const listener of listeners.keys()) listener();
    schedule();
  }
  return (expiry: number, listener: () => void) => {
    listeners.set(listener, expiry);
    if (listeners.size === 1) stopObserving = observeActivity(refresh);
    schedule();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopObserving?.();
        stopObserving = undefined;
      }
      schedule();
    };
  };
}

/** Cache each phase so React redraws only when the displayed state changes. */
export function createCacheHudSnapshot(hud: OrchestrationV2CacheHud | null | undefined) {
  let current: ReturnType<typeof presentCacheHud> | null = null;
  return () => {
    if (!hud) return null;
    // @effect-diagnostics-next-line globalDate:off -- React reads this synchronous external-store snapshot.
    const next = presentCacheHud(hud, Date.now());
    if (current?.state !== next.state) current = next;
    return current;
  };
}
