import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { availableResetCount } from "./resetAvailability.logic";

export function ResetAvailability({ accounts }: { readonly accounts: readonly LimitAccount[] }) {
  const count = availableResetCount(accounts);
  if (count === null) return null;
  return (
    <p className="mt-1 text-3xs text-muted-foreground">
      {count} {count === 1 ? "reset" : "resets"} available
    </p>
  );
}
