import { ProviderDriverKind } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { compactUsage, groupUsageWindows } from "./usageCompact";

const GRID_COLUMNS = ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3"] as const;
const POPUP_WIDTH = ["w-64", "w-64", "w-92", "w-128"] as const;

export function CompactUsageControl({
  accounts,
  drivers,
  notices = [],
  authNotices = [],
  disconnected = false,
  onOpenFullView,
}: {
  accounts: Parameters<typeof compactUsage>[0];
  drivers?: Parameters<typeof compactUsage>[2];
  notices?: readonly string[];
  authNotices?: readonly string[];
  disconnected?: boolean;
  onOpenFullView: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const providers = compactUsage(accounts, now, drivers);
  if (providers.length === 0) return null;
  const summary = providers
    .map((provider) => `${provider.label} ${percent(provider.remaining)}`)
    .join(", ");
  return (
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
            aria-label={`Usage remaining: ${summary}${notices.length > 0 ? ". Partial report" : ""}${disconnected ? ". Environment disconnected" : ""}${authNotices.length > 0 ? ". Session sign-in unconfirmed" : ""}. Open full usage`}
            data-toolbar-control
            data-header-usage
            className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1 text-foreground outline-hidden [-webkit-app-region:no-drag] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-popup-open:bg-accent"
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
          <span key={provider.driver} aria-hidden className="flex items-center gap-1">
            <ProviderInstanceIcon
              driverKind={ProviderDriverKind.make(provider.driver)}
              displayName={provider.label}
              iconClassName="size-3"
              showBadge={false}
            />
            <span
              className={`font-mono text-2xs whitespace-nowrap tabular-nums ${quotaColor(provider.remaining)}`}
            >
              {percent(provider.remaining)}
            </span>
          </span>
        ))}
        {notices.length > 0 || disconnected || authNotices.length > 0 ? (
          <span aria-hidden className="absolute top-1 right-0.5 size-1 rounded-full bg-warning" />
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        align="end"
        padding="compact"
        className={cn("max-w-[calc(100vw-2rem)]", POPUP_WIDTH[providers.length])}
        initialFocus={false}
        finalFocus={false}
      >
        <div className="flex items-baseline gap-2">
          <PopoverTitle>Quota remaining</PopoverTitle>
          <span className="ms-auto text-3xs text-muted-foreground">
            All authenticated harnesses · click opens Usage
          </span>
        </div>
        {authNotices.length > 0 ? (
          <ul className="mt-1 text-3xs text-muted-foreground">
            {[...new Set(authNotices)].map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : null}
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
        <div
          className={cn(
            "mt-2 grid max-h-[min(28rem,calc(var(--available-height)-4rem))] grid-cols-1 gap-x-4 gap-y-3 overflow-y-auto",
            GRID_COLUMNS[providers.length],
          )}
        >
          {providers.map((provider) => (
            <section key={provider.driver} aria-label={provider.label} className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <ProviderInstanceIcon
                  driverKind={ProviderDriverKind.make(provider.driver)}
                  displayName={provider.label}
                  iconClassName="size-3.5"
                  showBadge={false}
                />
                <span>{provider.label}</span>
                <span className="ms-auto font-mono text-3xs font-normal tabular-nums">
                  {percent(provider.remaining)}
                </span>
              </div>
              {provider.accounts.length > 1 ? (
                <p className="text-3xs text-muted-foreground">
                  {provider.accounts.length} accounts · pooled
                </p>
              ) : null}
              {provider.windows.length === 0 ? (
                <p className="mt-1 text-3xs text-muted-foreground">Limits unavailable</p>
              ) : (
                groupUsageWindows(provider.windows).map((group) => (
                  <div
                    key={`${group.rows[0]?.window.kind}:${group.rows[0]?.window.id}`}
                    className="mt-1.5"
                  >
                    {group.title ? (
                      <p className="text-3xs text-muted-foreground">{group.title}</p>
                    ) : null}
                    {group.rows.map(({ label, window }) => {
                      const reset = window.resets.find((reset) => reset.at > now);
                      const remaining = Math.max(0, Math.min(100, window.remainingPercent));
                      return (
                        <div key={`${window.kind}:${window.id}`} className="mt-0.5">
                          <div className="grid grid-cols-[minmax(0,1fr)_2rem_3rem] items-baseline gap-1 text-3xs">
                            <Tooltip>
                              <TooltipTrigger render={<span className="truncate" />}>
                                {label}
                              </TooltipTrigger>
                              <TooltipPopup>{window.label}</TooltipPopup>
                            </Tooltip>
                            <span
                              className={`text-right font-mono tabular-nums ${quotaColor(window.remainingPercent)}`}
                            >
                              {percent(window.remainingPercent)}
                            </span>
                            <span className="text-right whitespace-nowrap text-muted-foreground">
                              {reset ? `↻ ${formatDuration(reset.at - now)}` : "n/a"}
                            </span>
                          </div>
                          <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-muted-foreground"
                              style={{ width: `${remaining}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              {provider.accounts.length > 0 ? (
                <p className="mt-1 text-3xs text-muted-foreground">
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
