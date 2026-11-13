import type { LimitAccount } from "@t3tools/shared/usageLimits";

export function availableResetCount(accounts: readonly Pick<LimitAccount, "limits">[]) {
  const credits = accounts.flatMap((account) =>
    account.limits.resetCredits ? [account.limits.resetCredits.availableCount] : [],
  );
  return credits.length === 0 ? null : credits.reduce((sum, available) => sum + available, 0);
}
