import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { OrchestrationV2CacheHud } from "@t3tools/contracts";
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
}) {
  const hud = props.hud;
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
  const view = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!view) return null;
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
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="min-w-0 px-4 pt-2 text-left"
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
  );
}
