import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { OrchestrationV2CacheHud, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { createCacheHudClock, createCacheHudSnapshot } from "@t3tools/shared/cacheHud";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

const subscribe = createCacheHudClock(
  () => document.visibilityState === "visible",
  (refresh) => {
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  },
);

export function CacheHud(props: {
  hud: OrchestrationV2CacheHud | null | undefined;
  compact?: boolean;
  usageWindows?: readonly ServerProviderUsageWindow[] | undefined;
}) {
  const hud = props.hud;
  const view = useCacheHudView(hud);
  const usageWindows =
    props.usageWindows?.filter((window) => window.kind === "session" || window.kind === "weekly") ??
    [];
  if (!view && usageWindows.length === 0) return null;
  if (!view) {
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-t-lg border border-b-0 bg-background px-4 py-1.5 text-xs text-muted-foreground shadow-sm">
        <span className="min-w-0 flex-1" />
        <UsageWindows windows={usageWindows} />
      </div>
    );
  }
  const color =
    view.state === "expiring"
      ? "text-warning-foreground font-semibold"
      : view.state === "cold" || view.state === "unknown"
        ? "text-secondary-label"
        : "text-foreground";
  const content = (
    <span className={`truncate font-mono text-xs tabular-nums ${color}`}>
      {view.cacheText}
      {props.compact ? null : ` · ${view.contextText}`}
    </span>
  );
  if (props.compact)
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span className="block min-w-0 truncate" aria-label={view.description} />}
        >
          {content}
        </TooltipTrigger>
        <TooltipPopup>
          <p className="max-w-sm">{view.description}</p>
        </TooltipPopup>
      </Tooltip>
    );
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-t-lg border border-b-0 bg-background px-4 py-1.5 text-xs shadow-sm">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              aria-label="Cache and context details"
            />
          }
        >
          {content}
        </PopoverTrigger>
        <PopoverPopup>
          <p className="max-w-sm text-sm">{view.description}</p>
        </PopoverPopup>
      </Popover>
      <UsageWindows windows={usageWindows} />
    </div>
  );
}

export function useCacheHudView(hud: OrchestrationV2CacheHud | null | undefined) {
  const expiry =
    hud?.ttlMs !== undefined &&
    ((hud.usage.cachedInputTokens ?? 0) > 0 || (hud.usage.cacheCreationTokens ?? 0) > 0)
      ? Date.parse(hud.usage.updatedAt) + hud.ttlMs
      : null;
  const clockSubscribe = useCallback(
    (listener: () => void) => (expiry !== null ? subscribe(expiry, listener) : () => {}),
    [expiry],
  );
  const snapshot = useMemo(() => createCacheHudSnapshot(hud), [hud]);
  return useSyncExternalStore(clockSubscribe, snapshot, snapshot);
}

function UsageWindows({ windows }: { windows: readonly ServerProviderUsageWindow[] }) {
  if (windows.length === 0) return null;
  const now = Date.now();
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-muted-foreground">
      {windows.map((window) => {
        const label =
          window.kind === "weekly"
            ? "Week"
            : window.windowDurationMins === 300
              ? "5h"
              : window.label;
        const reset = formatResetsIn(window, now)?.replace(/^resets in /, "↻ ");
        return (
          <span key={window.id} className="whitespace-nowrap tabular-nums">
            {label} {Math.max(0, 100 - Math.round(window.usedPercent))}% left
            {reset ? ` · ${reset}` : ""}
          </span>
        );
      })}
    </span>
  );
}
