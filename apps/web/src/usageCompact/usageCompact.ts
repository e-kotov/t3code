import {
  collectLimitPools,
  displayLimitWindows,
  type LimitAccount,
} from "@t3tools/shared/usageLimits";

const PROVIDERS = [
  { driver: "codex", label: "Codex", shortLabel: "Codex" },
  { driver: "claudeAgent", label: "Claude", shortLabel: "Claude" },
  { driver: "antigravity", label: "Antigravity", shortLabel: "agy" },
] as const;

export function compactUsage(accounts: readonly LimitAccount[], now: number) {
  const pools = collectLimitPools(
    accounts.filter((account) => !account.limits.unavailable),
    now,
  );
  return PROVIDERS.map((provider) => {
    const pool = pools.find((candidate) => candidate.driver === provider.driver);
    const windows = pool ? displayLimitWindows(pool) : [];
    return {
      ...provider,
      accounts: pool?.accounts ?? [],
      windows,
      remaining:
        windows.length === 0
          ? null
          : Math.max(0, Math.min(100, Math.min(...windows.map((w) => w.remainingPercent)))),
    };
  });
}
