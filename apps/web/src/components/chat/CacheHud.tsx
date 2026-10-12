import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { OrchestrationV2CacheHud, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { createCacheHudClock, createCacheHudSnapshot } from "@t3tools/shared/cacheHud";
import type { ReactNode } from "react";
import { ComposerBanner } from "./ComposerBanner";

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
      <HudTab>
        <span className="min-w-0 flex-1" />
        <UsageWindows windows={usageWindows} />
      </HudTab>
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
      <span className="block min-w-0 truncate" aria-label={view.description}>
        {content}
      </span>
    );
  return (
    <HudTab>
      <span className="min-w-0 flex-1 truncate" aria-label={view.description}>
        {content}
      </span>
      <UsageWindows windows={usageWindows} />
    </HudTab>
  );
}

// Joins the composer's tab stack so tasks and notices share its outline and inset.
function HudTab({ children }: { children: ReactNode }) {
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root data-composer-cache-hud="true">
        <div className="flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2.5 text-muted-foreground">
          {children}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
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
