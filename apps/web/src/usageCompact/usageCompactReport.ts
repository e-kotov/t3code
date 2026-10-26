import {
  collectLimitAccounts,
  collectLimitNotices,
  limitsNotice,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

export function compactUsageReport(presentations: LimitPresentations) {
  const notices = [...collectLimitNotices(presentations)];
  for (const presentation of presentations.values()) {
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      for (const account of source.accounts) {
        if (account.usageLimits.unavailable?.reason !== "probeFailed") continue;
        notices.push(
          `${source.label} · ${account.email ?? account.id}: ${limitsNotice(account.usageLimits)}`,
        );
      }
    }
  }
  return { accounts: collectLimitAccounts(presentations), notices };
}
