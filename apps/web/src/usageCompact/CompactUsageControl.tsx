import { ProviderDriverKind } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { SidebarMenuItem } from "../components/ui/sidebar";
import { useNowMinute } from "../hooks/useNowMinute";
import { compactUsage } from "./usageCompact";

export function CompactUsageControl({
  accounts,
  notices = [],
  disconnected = false,
  onOpenFullView,
}: {
  accounts: Parameters<typeof compactUsage>[0];
  notices?: readonly string[];
  disconnected?: boolean;
  onOpenFullView: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const providers = compactUsage(accounts, now);
  const summary = providers
    .map((provider) => `${provider.label}: ${percent(provider.remaining)}`)
    .join(", ");
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover
        open={open}
        onOpenChange={(nextOpen, details) => {
          // Pressing the trigger opens the full usage page; only hover and focus show details.
          if (details.reason === "trigger-press") details.cancel();
          if (!details.isCanceled) setOpen(nextOpen);
        }}
      >
        <PopoverTrigger
          openOnHover
          closeDelay={150}
          render={
            <button
              type="button"
              aria-label={`Usage remaining. ${summary}${notices.length > 0 ? ". Partial report" : ""}`}
              className="relative flex h-8 w-12 items-center justify-center gap-1 rounded-md text-sidebar-foreground outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => {
                setOpen(false);
                onOpenFullView();
              }}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) setOpen(true);
              }}
            />
          }
        >
          {providers.map((provider) => (
            <span key={provider.driver} aria-hidden className="flex flex-col items-center gap-0.5">
              <ProviderInstanceIcon
                driverKind={ProviderDriverKind.make(provider.driver)}
                displayName={provider.label}
                iconClassName="size-3"
                showBadge={false}
              />
              <span
                className={`h-0.5 w-3 overflow-hidden rounded-full bg-muted ${quotaColor(provider.remaining)}`}
              >
                <span
                  className="block h-full rounded-full bg-current"
                  style={{ width: `${provider.remaining ?? 0}%` }}
                />
              </span>
            </span>
          ))}
          {notices.length > 0 ? (
            <span aria-hidden className="absolute top-1 right-0.5 size-1 rounded-full bg-warning" />
          ) : null}
        </PopoverTrigger>
        <PopoverPopup
          side="top"
          align="start"
          width="sm"
          padding="compact"
          initialFocus={false}
          finalFocus={false}
        >
          <PopoverTitle>Quota remaining</PopoverTitle>
          <p className="mt-1 text-3xs text-muted-foreground">
            Last reported · subscription quota first
          </p>
          {notices.length > 0 ? (
            <div className="mt-1 text-3xs text-warning-foreground">
              <p>Partial report. Some account limits are unavailable.</p>
              <ul className="max-h-16 overflow-y-auto">
                {[...new Set(notices)].map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {disconnected ? (
            <p className="mt-1 text-3xs text-warning-foreground">
              An environment is disconnected; its values may be out of date.
            </p>
          ) : null}
          <div className="mt-2 space-y-2">
            {providers.map((provider) => (
              <section key={provider.driver} aria-label={provider.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs font-medium">
                  <span>{provider.label}</span>
                  {provider.accounts.length > 1 ? (
                    <span className="text-3xs font-normal text-muted-foreground">
                      {provider.accounts.length} accounts · pooled
                    </span>
                  ) : null}
                </div>
                {provider.windows.length === 0 ? (
                  <p className="text-3xs text-muted-foreground">No quota reported</p>
                ) : (
                  <div className="max-h-28 space-y-0.5 overflow-y-auto">
                    {provider.windows.map((window) => {
                      const reset = window.resets.find((reset) => reset.at > now);
                      return (
                        <div key={window.id} className="flex items-baseline gap-2 text-3xs">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {window.label}
                          </span>
                          <span
                            className={`font-mono tabular-nums ${quotaColor(window.remainingPercent)}`}
                          >
                            {percent(window.remainingPercent)}
                          </span>
                          <span className="w-16 text-right text-muted-foreground">
                            {reset ? `↻ ${formatDuration(reset.at - now)}` : "?"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {provider.accounts.length > 0 ? (
                  <p className="text-3xs text-muted-foreground">
                    Checked{" "}
                    {new Date(
                      Math.min(
                        ...provider.accounts.map((account) => Date.parse(account.limits.checkedAt)),
                      ),
                    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

function percent(remaining: number | null) {
  return remaining === null ? "?" : `${Math.max(0, Math.min(100, remaining))}%`;
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
