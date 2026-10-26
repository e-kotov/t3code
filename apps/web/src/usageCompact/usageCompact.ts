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
    return {
      ...provider,
      accounts: pool?.accounts ?? [],
      windows,
      remaining:
        headlineWindows.length === 0
          ? null
          : Math.max(0, Math.min(100, Math.min(...headlineWindows.map((w) => w.remainingPercent)))),
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
