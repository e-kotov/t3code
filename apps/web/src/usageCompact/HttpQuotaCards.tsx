import { T, useMessages } from "gt-react";
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

/** HTTP quota sources on the Usage page, one card per pool with bars like subscription limits. */
export function HttpQuotaCards({
  sources,
  now,
}: {
  readonly sources: readonly CompactHttpQuotaSource[];
  readonly now: number;
}) {
  return sources.map((source) => (
    <section key={source.key} aria-label={source.label} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <GaugeIcon className="size-4 shrink-0 text-foreground/80" aria-hidden />
        {source.label}
      </h2>
      {source.quotaAccounts?.flatMap((account) =>
        groupUsageWindows(account.windows).map((group) => (
          <QuotaPoolCard
            key={`${account.id}:${group.rows[0]?.window.id}`}
            title={group.title ?? account.label}
            rows={group.rows}
            now={now}
          />
        )),
      )}
    </section>
  ));
}

function QuotaPoolCard({
  title,
  rows,
  now,
}: {
  readonly title: string;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly window: QuotaWindow }>;
  readonly now: number;
}) {
  const m = useMessages();
  const tightestLeft = Math.min(...rows.map(({ window }) => remainingPercent(window)));
  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
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
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3"
            >
              <span className="truncate text-xs text-muted-foreground">{label}</span>
              <div className="relative h-8 min-w-0 overflow-hidden rounded-md bg-muted">
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-md opacity-35",
                    quotaFillClass(remaining),
                  )}
                  style={{ width: `${remaining}%` }}
                />
                <div className="relative flex h-full min-w-0 items-center gap-1.5 px-2 text-xs">
                  <span className="shrink-0 font-semibold text-foreground tabular-nums">
                    {remaining}%
                  </span>
                  {refill ? (
                    <span className="ms-auto min-w-0 truncate rounded-sm bg-background/85 px-1.5 py-0.5 text-2xs whitespace-nowrap text-foreground tabular-nums">
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
