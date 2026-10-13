import type {
  ModelSelection,
  OrchestrationV2CacheHud,
  OrchestrationV2ProviderTurnTokenUsage,
  ProviderDriverKind,
} from "@t3tools/contracts";

const CODEX_BASELINE_MS = 30 * 60_000;

/** Port of Herdr's conservative Codex policy: only shorten after three
 * comparable observed misses; neither elapsed time nor a hit proves retention. */
function estimatedCodexLifetime(reports: ReadonlyArray<OrchestrationV2ProviderTurnTokenUsage>) {
  const observations: number[] = [];
  let hit: OrchestrationV2ProviderTurnTokenUsage | undefined;
  for (const report of reports) {
    if ((report.cachedInputTokens ?? 0) > 0) {
      hit = report;
    } else if (hit && (report.inputTokens ?? 0) >= 1024) {
      const elapsed = Date.parse(report.updatedAt) - Date.parse(hit.updatedAt);
      if (
        elapsed >= 60_000 &&
        elapsed < CODEX_BASELINE_MS &&
        report.cacheScopeKey !== undefined &&
        report.cacheScopeKey === hit.cacheScopeKey &&
        report.usedTokens >= hit.usedTokens * 0.9
      )
        observations.push(elapsed);
      hit = undefined;
    }
  }
  if (observations.length < 3) return CODEX_BASELINE_MS;
  const sorted = observations.slice(-25).sort((a, b) => a - b);
  const trim = sorted.length >= 5 ? Math.floor(sorted.length * 0.1) : 0;
  const inliers = sorted.slice(trim, sorted.length - trim);
  return Math.min(
    CODEX_BASELINE_MS,
    Math.floor(inliers.reduce((sum, n) => sum + n, 0) / inliers.length),
  );
}

/** Derive one compact server-owned summary, not transcript data, for every client. */
export function deriveCacheHud(
  driver: ProviderDriverKind,
  reports: ReadonlyArray<OrchestrationV2ProviderTurnTokenUsage>,
  modelSelection: ModelSelection,
): OrchestrationV2CacheHud | null {
  const scope = `${modelSelection.instanceId}:${modelSelection.model}`;
  const meaningful = [...reports]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
    .slice(-64)
    .filter(
      (report) =>
        Number.isFinite(Date.parse(report.updatedAt)) &&
        (report.cacheScopeKey === undefined || report.cacheScopeKey === scope) &&
        ((report.inputTokens ?? 0) > 0 ||
          (report.cachedInputTokens ?? 0) > 0 ||
          (report.cacheCreationTokens ?? 0) > 0 ||
          (report.inputTokens === undefined && report.usedTokens > 0)),
    );
  const usage = meaningful.at(-1);
  if (!usage) return null;
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
  if (driver === "codex")
    return { driver, usage, ttlMs: estimatedCodexLifetime(meaningful), basis: "estimated" };
  return { driver, usage, basis: "unknown" };
}

export function formatHudTokens(value: number) {
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
  const state =
    observedCold || remainingMs === 0
      ? "cold"
      : remainingMs === null || (cached === undefined && !usage.cacheCreationTokens)
        ? "unknown"
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
  const description = `Context tokens: ${usage.usedTokens}/${max ?? "unknown"}${contextPercentage === null ? "" : ` (${contextPercentage}%)`}. Last-request cached tokens: ${cached ?? "unknown"}${percentage === null ? "" : ` (${percentage}%)`}.${usage.cacheCreationTokens === undefined ? "" : ` Cache-write tokens: ${usage.cacheCreationTokens}.`} Cache expiry${remainingMs === null ? "" : ` at ${clock} (device local time)`} is an estimate${hud.basis === "reported" ? " based on Claude's reported lifetime" : hud.basis === "estimated" ? " using Codex's 30-minute baseline and recent observed misses" : "; lifetime is unknown"}. Prefix changes and eviction can make it cold earlier.`;
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
      ? "Cache lifetime unknown"
      : view.state === "cold"
        ? view.remainingMs === 0
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
