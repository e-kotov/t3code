import {
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

const PROVIDERS = [
  { driver: "codex", label: "Codex", shortLabel: "Codex" },
  { driver: "claudeAgent", label: "Claude", shortLabel: "Claude" },
  { driver: "antigravity", label: "Antigravity", shortLabel: "agy" },
] as const;

export const COMPACT_USAGE_DRIVERS = PROVIDERS.map((provider) => provider.driver);

export interface CompactUsageBar {
  readonly label: string;
  readonly remaining: number;
}

function isArgonModel(model?: string | null | undefined): boolean {
  return typeof model === "string" && model.toLowerCase().includes("argon");
}

function isProxyModel(model?: string | null | undefined): boolean {
  if (typeof model !== "string") return false;
  const lower = model.toLowerCase();
  return lower.startsWith("claude-") || lower.startsWith("gpt-");
}

function isFableModel(model?: string | null | undefined): boolean {
  return typeof model === "string" && model.toLowerCase().includes("fable");
}

function isArgonWindow(w: LimitPoolWindow): boolean {
  return w.id.toLowerCase().includes("argon") || w.label.toLowerCase().includes("argon");
}

function isProxyWindow(w: LimitPoolWindow): boolean {
  const text = `${w.id} ${w.label}`.toLowerCase();
  return (
    text.includes("proxy") ||
    text.includes("3p") ||
    text.includes("third-party") ||
    text.includes("claude") ||
    text.includes("gpt")
  );
}

function isFableWindow(w: LimitPoolWindow): boolean {
  return w.id.toLowerCase().includes("fable") || w.label.toLowerCase().includes("fable");
}

function isPrimaryGeminiWindow(w: LimitPoolWindow): boolean {
  return !isArgonWindow(w) && !isProxyWindow(w);
}

function selectRelevantWindows(
  windows: readonly LimitPoolWindow[],
  driver: string,
  activeModel?: string | null | undefined,
): readonly LimitPoolWindow[] {
  if (driver === "antigravity") {
    if (isArgonModel(activeModel)) {
      return windows.filter(isArgonWindow);
    }
    if (isProxyModel(activeModel)) {
      return windows.filter(isProxyWindow);
    }
    const primary = windows.filter(isPrimaryGeminiWindow);
    return primary.length > 0 ? primary : windows;
  }
  if (driver === "claudeAgent") {
    if (isFableModel(activeModel)) {
      const fable = windows.filter(isFableWindow);
      if (fable.length === 0) return [];
      return windows.filter((w) => w.kind === "session" || isFableWindow(w));
    }
    const standard = windows.filter((w) => !isFableWindow(w));
    return standard.length > 0 ? standard : windows;
  }
  return windows;
}

export function compactUsage(
  accounts: readonly LimitAccount[],
  now: number,
  drivers?: ReadonlySet<string>,
  activeModel?: string | null | undefined,
  activeDriver?: string | null | undefined,
) {
  const pools = collectLimitPools(
    accounts.filter((account) => !account.limits.unavailable),
    now,
  );
  const shown = PROVIDERS.filter((provider) => !drivers || drivers.has(provider.driver));
  return shown.map((provider) => {
    const pool = pools.find((candidate) => candidate.driver === provider.driver);
    const windows = pool ? displayLimitWindows(pool) : [];
    const quotaWindows = windows.filter(
      (window) => provider.driver !== "claudeAgent" || window.id !== "monthly_spend",
    );

    const isDriverMatch =
      !activeDriver ||
      activeDriver === provider.driver ||
      (provider.driver === "claudeAgent" &&
        (activeDriver === "anthropic" || activeDriver === "claude"));
    const effectiveModel = isDriverMatch ? activeModel : null;

    const isExplicit =
      isArgonModel(effectiveModel) || isProxyModel(effectiveModel) || isFableModel(effectiveModel);

    const relevantQuotaWindows = selectRelevantWindows(
      quotaWindows,
      provider.driver,
      effectiveModel,
    );

    const headlineWindows =
      isExplicit && relevantQuotaWindows.length === 0
        ? []
        : relevantQuotaWindows.length > 0
          ? relevantQuotaWindows
          : quotaWindows.length > 0
            ? quotaWindows
            : windows;

    const tightest = (kind: LimitPoolWindow["kind"]) => {
      const matching = headlineWindows.filter((window) => window.kind === kind);
      return matching.length === 0
        ? null
        : Math.max(0, Math.min(100, Math.min(...matching.map((w) => w.remainingPercent))));
    };
    const session = tightest("session");
    const weekly = tightest("weekly");
    const monthly = session === null && weekly === null ? tightest("monthly") : null;
    const bars: CompactUsageBar[] = [
      ...(session === null ? [] : [{ label: "5h", remaining: session }]),
      ...(weekly === null ? [] : [{ label: "w", remaining: weekly }]),
      ...(monthly === null ? [] : [{ label: "mo", remaining: monthly }]),
    ];

    const remaining =
      headlineWindows.length === 0
        ? null
        : Math.max(0, Math.min(100, Math.min(...headlineWindows.map((w) => w.remainingPercent))));

    return {
      ...provider,
      accounts: pool?.accounts ?? [],
      windows,
      remaining,
      bars,
    };
  });
}

/** Group consecutive windows whose reported labels share a "Family · Window" prefix. */
export function groupUsageWindows(windows: readonly LimitPoolWindow[]) {
  const groups: Array<{
    title: string | null;
    rows: Array<{ label: string; window: LimitPoolWindow }>;
  }> = [];
  for (const window of windows) {
    const split = window.label.indexOf(" · ");
    const title = split > 0 ? window.label.slice(0, split) : null;
    const label = split > 0 ? window.label.slice(split + 3) : window.label;
    const last = groups.at(-1);
    if (last && last.title === title) last.rows.push({ label, window });
    else groups.push({ title, rows: [{ label, window }] });
  }
  return groups;
}
