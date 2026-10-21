import { useSyncExternalStore } from "react";
import type { OrchestrationV2CacheHud, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { cacheHudExpiry, createCacheHudClock, createCacheHudSnapshot } from "@t3tools/shared/cacheHud";
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
      : view.state === "cold" || view.state === "miss" || view.state === "unknown"
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
  const expiry = cacheHudExpiry(hud);
  const clockSubscribe = (listener: () => void) =>
    expiry !== null ? subscribe(expiry, listener) : () => {};
  const snapshot = createCacheHudSnapshot(hud);
  return useSyncExternalStore(clockSubscribe, snapshot, snapshot);
}

function UsageWindows({ windows }: { windows: readonly ServerProviderUsageWindow[] }) {
  if (windows.length === 0) return null;
  const now = Date.now();
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-muted-foreground">
      {windows.map((window) => {
        const label = usageWindowLabel(window);
        const remaining = Math.max(0, 100 - Math.round(window.usedPercent));
        const resetsIn = formatResetsIn(window, now);
        return (
          <span
            key={window.id}
            className="whitespace-nowrap tabular-nums"
            aria-label={`${window.label}: ${remaining}% left${resetsIn ? `, ${resetsIn}` : ""}`}
          >
            {label} {remaining}%{resetsIn ? ` ↻ ${resetsIn.replace(/^resets in /, "")}` : ""}
          </span>
        );
      })}
    </span>
  );
}

// "Session" -> "5h", "Weekly" -> "W", "Weekly · Fable" -> "F": the account-wide
// weekly and each model-scoped weekly get their own letter.
function usageWindowLabel(window: ServerProviderUsageWindow): string {
  if (window.kind === "session" && window.windowDurationMins === 300) return "5h";
  if (window.kind !== "weekly") return window.label;
  const scope = window.label.match(/^Weekly · (.+)$/)?.[1];
  return scope ? scope.charAt(0).toUpperCase() : "W";
}
