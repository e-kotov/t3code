import { formatDuration } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { SidebarMenuItem } from "../components/ui/sidebar";
import { compactUsage } from "./usageCompact";

export function CompactUsageControl({
  accounts,
  disconnected = false,
  onOpenFullView,
}: {
  accounts: Parameters<typeof compactUsage>[0];
  disconnected?: boolean;
  onOpenFullView: () => void;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const providers = compactUsage(accounts, now);
  const summary = providers
    .map((provider) => `${provider.label}: ${percent(provider.remaining)}`)
    .join(", ");
  return (
    <SidebarMenuItem className="min-w-0 flex-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Usage remaining. ${summary}`}
              title={`Last reported quota remaining (lowest window). ${summary}`}
              className="grid h-8 w-full min-w-24 grid-cols-3 items-center gap-1 rounded-[var(--control-radius)] px-1 text-center hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
            />
          }
        >
          {providers.map((provider) => (
            <span key={provider.driver} className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[9px] text-muted-foreground">
                {provider.shortLabel}
              </span>
              <span className={`font-mono text-[11px] tabular-nums ${quotaColor(provider.remaining)}`}>
                {percent(provider.remaining)}
              </span>
            </span>
          ))}
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" width="sm" padding="compact">
          <PopoverTitle>Quota remaining</PopoverTitle>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Last reported · lowest window in the button
          </p>
          {disconnected ? (
            <p className="mt-1 text-[10px] text-warning-foreground">
              An environment is disconnected; its values may be out of date.
            </p>
          ) : null}
          <div className="my-2 space-y-2">
            {providers.map((provider) => (
              <section key={provider.driver} aria-label={provider.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs font-medium">
                  <span>{provider.label}</span>
                  {provider.accounts.length > 1 ? (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {provider.accounts.length} accounts · pooled
                    </span>
                  ) : null}
                </div>
                {provider.windows.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No quota reported</p>
                ) : (
                  <div className="max-h-28 space-y-0.5 overflow-y-auto">
                    {provider.windows.map((window) => {
                      const reset = window.resets.find((reset) => reset.at > now);
                      return (
                        <div key={window.id} className="flex items-baseline gap-2 text-[10px]">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {window.label}
                          </span>
                          <span className={`font-mono tabular-nums ${quotaColor(window.remainingPercent)}`}>
                            {percent(window.remainingPercent)}
                          </span>
                          <span
                            className="w-16 text-right text-muted-foreground"
                            title={reset ? new Date(reset.at).toLocaleString() : undefined}
                          >
                            {reset ? `↻ ${formatDuration(reset.at - now)}` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {provider.accounts.length > 0 ? (
                  <p className="text-[9px] text-muted-foreground">
                    Checked {new Date(Math.min(...provider.accounts.map((account) => Date.parse(account.limits.checkedAt)))).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setOpen(false);
              onOpenFullView();
            }}
          >
            Open full usage
          </Button>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

function percent(remaining: number | null) {
  return remaining === null ? "—" : `${Math.max(0, Math.min(100, remaining))}%`;
}

function quotaColor(remaining: number | null) {
  return remaining === null
    ? "text-muted-foreground"
    : remaining <= 10
      ? "text-destructive-foreground"
      : remaining <= 25
        ? "text-warning-foreground"
        : "text-foreground";
}
