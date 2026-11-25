import { msg, T, useMessages } from "gt-react";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { GaugeIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { groupUsageWindows, quotaFillClass, type CompactHttpQuotaSource } from "./usageCompact";

type QuotaWindow = NonNullable<CompactHttpQuotaSource["quotaAccounts"]>[number]["windows"][number];

/**
 * The Usage page draws HTTP quota sources with `HttpQuotaCards`. Upstream's plain text rows
 * stay in its file but map over this empty list, so upstream edits to them still merge cleanly.
 */
export function upstreamQuotaRows<Source>(sources: readonly Source[]): readonly Source[] {
  return sources.slice(0, 0);
}

/**
 * HTTP quota sources on the Usage page: each account under its own heading, then one card per
 * pool with bars like subscription limits. Exact counts and reset times wrap rather than clip.
 */
export function HttpQuotaCards({
  sources,
  now,
}: {
  readonly sources: readonly CompactHttpQuotaSource[];
  readonly now: number;
}) {
  const m = useMessages();
  return sources.map((source) => (
    <section key={source.key} aria-label={source.label} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium wrap-anywhere text-foreground">
        <GaugeIcon className="size-4 shrink-0 text-foreground/80" aria-hidden />
        {source.label}
      </h2>
      {source.quotaAccounts?.map((account) => (
        <div key={account.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium wrap-anywhere text-foreground">{account.label}</h3>
          {account.windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m(msg("No limits reported."))}</p>
          ) : (
            groupUsageWindows(account.windows).map((group) => (
              <QuotaPoolCard
                key={group.rows[0]?.window.id}
                title={group.title}
                rows={group.rows}
                now={now}
              />
            ))
          )}
        </div>
      ))}
    </section>
  ));
}

function QuotaPoolCard({
  title,
  rows,
  now,
}: {
  readonly title: string | null;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly window: QuotaWindow }>;
  readonly now: number;
}) {
  const m = useMessages();
  const tightestLeft = Math.min(...rows.map(({ window }) => remainingPercent(window)));
  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1">
        {title ? (
          <span className="text-sm font-medium wrap-anywhere text-foreground">{title}</span>
        ) : null}
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {tightestLeft}%
          </span>
          <span className="text-sm text-muted-foreground">
            <T context="remaining usage percentage">left</T>
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {rows.map(({ label, window }) => {
          const remaining = remainingPercent(window);
          const refill = formatResetsIn(window, now, m, "refill");
          return (
            <div
              key={window.id}
              className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-center"
            >
              <span className="min-w-0 text-xs wrap-anywhere text-muted-foreground">{label}</span>
              <div className="relative min-h-8 min-w-0 overflow-hidden rounded-md bg-muted">
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-md opacity-35",
                    quotaFillClass(remaining),
                  )}
                  style={{ width: `${remaining}%` }}
                />
                <div className="relative flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 py-1 text-xs">
                  <span className="shrink-0 font-semibold text-foreground tabular-nums">
                    {remaining}%
                  </span>
                  {refill ? (
                    <span className="ms-auto min-w-0 rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs wrap-anywhere text-foreground tabular-nums">
                      {refill}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
