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

export function compactUsage(
  accounts: readonly LimitAccount[],
  now: number,
  drivers?: ReadonlySet<string>,
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
    const headlineWindows = quotaWindows.length > 0 ? quotaWindows : windows;

    const sessionWindows = windows.filter(
      (window) =>
        window.kind === "session" ||
        window.windowDurationMins === 300 ||
        window.id === "five_hour" ||
        window.id === "primary" ||
        window.id.endsWith("-5h"),
    );
    const sessionRemaining =
      sessionWindows.length > 0
        ? Math.max(0, Math.min(100, Math.min(...sessionWindows.map((w) => w.remainingPercent))))
        : null;

    const weeklyWindows = windows.filter(
      (window) =>
        (window.kind === "weekly" ||
          window.windowDurationMins === 7 * 24 * 60 ||
          window.id === "seven_day" ||
          window.id === "secondary" ||
          window.id.endsWith("-weekly")) &&
        (provider.driver !== "claudeAgent" || window.id !== "monthly_spend"),
    );
    const weeklyRemaining =
      weeklyWindows.length > 0
        ? Math.max(0, Math.min(100, Math.min(...weeklyWindows.map((w) => w.remainingPercent))))
        : null;

    const bars: CompactUsageBar[] = [];
    if (sessionRemaining !== null) {
      bars.push({ label: "5h", remaining: sessionRemaining });
    }
    if (weeklyRemaining !== null) {
      bars.push({ label: "w", remaining: weeklyRemaining });
    }
    if (bars.length === 0 && headlineWindows.length > 0) {
      const monthlyWindows = windows.filter(
        (window) =>
          window.kind === "monthly" &&
          (provider.driver !== "claudeAgent" || window.id !== "monthly_spend"),
      );
      if (monthlyWindows.length > 0) {
        bars.push({
          label: "mo",
          remaining: Math.max(
            0,
            Math.min(100, Math.min(...monthlyWindows.map((w) => w.remainingPercent))),
          ),
        });
      }
    }

    return {
      ...provider,
      accounts: pool?.accounts ?? [],
      windows,
      remaining:
        headlineWindows.length === 0
          ? null
          : Math.max(0, Math.min(100, Math.min(...headlineWindows.map((w) => w.remainingPercent)))),
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
