import type { LimitAccount } from "@t3tools/shared/usageLimits";

export function ResetAvailability({ accounts }: { readonly accounts: readonly LimitAccount[] }) {
  const credits = accounts.flatMap((account) =>
    account.limits.resetCredits ? [account.limits.resetCredits.availableCount] : [],
  );
  if (credits.length === 0) return null;
  const count = credits.reduce((sum, available) => sum + available, 0);
  return (
    <p className="mt-1 text-3xs text-muted-foreground">
      {count} {count === 1 ? "reset" : "resets"} available
    </p>
  );
}
