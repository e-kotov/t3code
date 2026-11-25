import {
  collectHttpQuotaSources,
  collectLimitPools,
  displayLimitWindows,
  remainingPercent,
  type LimitAccount,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";

export type CompactHttpQuotaSource = ReturnType<typeof collectHttpQuotaSources>[number];

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

const HTTP_BAR_ORDER = ["1h", "5h", "d", "w", "mo"] as const;

function httpBarTag(window: {
  readonly id: string;
  readonly kind: "session" | "weekly" | "monthly" | "other";
}): (typeof HTTP_BAR_ORDER)[number] | null {
  const id = window.id.toLowerCase();
  if (id === "hour" || id === "hourly") return "1h";
  if (id === "day" || id === "daily") return "d";
  if (window.kind === "session") return "5h";
  if (window.kind === "weekly") return "w";
  if (window.kind === "monthly") return "mo";
  return null;
}

export function compactHttpQuotas(sources: readonly CompactHttpQuotaSource[]) {
  return sources.flatMap((source) =>
    (source.quotaAccounts ?? []).map((account) => {
      const windows = account.windows.map((window) => {
        const parsed = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
        return {
          id: window.id,
          kind: window.kind,
          label: window.label,
          remainingPercent: remainingPercent(window),
          resetAt: Number.isFinite(parsed) ? parsed : null,
        };
      });

      const tightestByTag = new Map<(typeof HTTP_BAR_ORDER)[number], number>();
      for (const window of windows) {
        const tag = httpBarTag(window);
        if (tag === null) continue;
        const previous = tightestByTag.get(tag);
        tightestByTag.set(
          tag,
          previous === undefined
            ? window.remainingPercent
            : Math.min(previous, window.remainingPercent),
        );
      }
      const bars: CompactUsageBar[] = HTTP_BAR_ORDER.flatMap((tag) => {
        const value = tightestByTag.get(tag);
        return value === undefined ? [] : [{ label: tag, remaining: value }];
      }).slice(0, 2);

      const remaining =
        bars.length > 0
          ? Math.min(...bars.map((bar) => bar.remaining))
          : windows.length > 0
            ? Math.min(...windows.map((window) => window.remainingPercent))
            : null;

      return {
        key: `${source.key}:${account.id}`,
        label: account.label,
        sourceLabel: source.label,
        checkedAt: source.checkedAt,
        windows,
        bars,
        remaining,
      };
    }),
  );
}

/** Bar fill for a remaining-quota percentage: green, amber at 25% or less, red at 10% or less. */
export function quotaFillClass(remaining: number): string {
  return remaining <= 10 ? "bg-destructive" : remaining <= 25 ? "bg-warning" : "bg-success";
}

function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${Math.round(value / 100) / 10}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value / 100_000) / 10}M`;
}

/** Shortens request counts such as "Day (1517/1600)" to "Day (1.5k/1.6k)" for narrow rows. */
export function compactCountLabel(label: string): string {
  return label.replace(
    /\b(\d+)\/(\d+)\b/g,
    (_match, left: string, right: string) =>
      `${compactCount(Number(left))}/${compactCount(Number(right))}`,
  );
}

/** Group consecutive windows whose reported labels share a "Family · Window" prefix. */
export function groupUsageWindows<T extends { readonly label: string }>(windows: readonly T[]) {
  const groups: Array<{
    title: string | null;
    rows: Array<{ label: string; window: T }>;
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
