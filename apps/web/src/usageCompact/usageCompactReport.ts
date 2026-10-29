import { isProviderAvailable, type ServerProvider } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitNotices,
  limitsNotice,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import { COMPACT_USAGE_DRIVERS } from "./usageCompact";

const shownDriver = (driver: ServerProvider["driver"]) =>
  COMPACT_USAGE_DRIVERS.some((shown) => shown === driver);

function hasVerifiedQuotaAccess(provider: ServerProvider): boolean {
  const limits = provider.usageLimits;
  if (
    provider.driver !== "antigravity" ||
    provider.auth.status !== "unknown" ||
    !limits?.credentialFingerprint ||
    limits.unavailable ||
    limits.windows.length === 0
  ) {
    return false;
  }
  // Match the successful OAuth probe to its health snapshot, not arbitrary cached windows.
  const snapshotLagMs = Date.parse(provider.checkedAt) - Date.parse(limits.checkedAt);
  return Number.isFinite(snapshotLagMs) && snapshotLagMs >= 0 && snapshotLagMs <= 60_000;
}

/** Signed-in native providers and proxy accounts; signed-out logins drop their stale windows. */
function authenticatedPresentations(presentations: LimitPresentations): LimitPresentations {
  return new Map(
    [...presentations].map(([id, presentation]) => {
      const config = presentation.serverConfig;
      if (config === null) return [id, presentation] as const;
      return [
        id,
        {
          ...presentation,
          serverConfig: {
            ...config,
            providers: config.providers.filter(
              (provider) =>
                shownDriver(provider.driver) &&
                (provider.auth.status === "authenticated" || hasVerifiedQuotaAccess(provider)),
            ),
            // As in the full Usage filter, a source emptied by filtering is not "no accounts".
            usageLimitSources: config.usageLimitSources?.flatMap((source) => {
              const accounts = source.accounts.filter((account) => shownDriver(account.driver));
              return accounts.length === 0 && source.accounts.length > 0
                ? []
                : [{ ...source, accounts }];
            }),
          },
        },
      ] as const;
    }),
  );
}

export function compactUsageReport(presentations: LimitPresentations) {
  const authenticated = authenticatedPresentations(presentations);
  const drivers = new Set<string>();
  const notices = [...collectLimitNotices(authenticated)];
  const authNotices = new Set<string>();
  for (const presentation of authenticated.values()) {
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (provider.enabled && provider.installed && isProviderAvailable(provider)) {
        drivers.add(provider.driver);
        if (hasVerifiedQuotaAccess(provider)) {
          authNotices.add(
            "Antigravity quota access verified; session sign-in is not yet confirmed.",
          );
        }
      }
    }
    for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
      for (const account of source.accounts) {
        drivers.add(account.driver);
        if (account.usageLimits.unavailable?.reason !== "probeFailed") continue;
        notices.push(
          `${source.label} · ${account.email ?? account.id}: ${limitsNotice(account.usageLimits)}`,
        );
      }
    }
  }
  return {
    accounts: collectLimitAccounts(authenticated),
    notices,
    drivers,
    authNotices: [...authNotices],
  };
}

export function disconnectedEnvironmentLabels(
  presentations: Iterable<{
    readonly entry: { readonly target: { readonly label: string } };
    readonly connection: { readonly phase: string };
  }>,
): string[] {
  const disconnected = [...presentations].filter(
    ({ connection }) => connection.phase !== "connected",
  );
  const unnamedCount = disconnected.filter(({ entry }) => !entry.target.label.trim()).length;
  let unnamedIndex = 0;
  return disconnected
    .map(
      ({ entry }) =>
        entry.target.label.trim() ||
        (unnamedCount > 1 ? `Unnamed environment ${++unnamedIndex}` : "An unnamed environment"),
    )
    .toSorted((a, b) => a.localeCompare(b));
}
