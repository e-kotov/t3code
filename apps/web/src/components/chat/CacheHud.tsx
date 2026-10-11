import { useCallback, useSyncExternalStore } from "react";
import type { OrchestrationV2CacheHud } from "@t3tools/contracts";
import { presentCacheHud } from "@t3tools/shared/cacheHud";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}
function resume() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (listeners.size && document.visibilityState === "visible") {
    tick();
    timer = setInterval(tick, 15_000);
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", resume);
    resume();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", resume);
    }
  };
}
const snapshot = () => now;
const noopSubscribe = () => () => {};

/** One foreground clock serves every visible row; no per-thread timers. */
export function CacheHud(props: {
  hud: OrchestrationV2CacheHud | null | undefined;
  compact?: boolean;
}) {
  const ticking =
    !!props.hud?.ttlMs &&
    Date.parse(props.hud.usage.updatedAt) + props.hud.ttlMs > Date.now() &&
    ((props.hud.usage.cachedInputTokens ?? 0) > 0 ||
      (props.hud.usage.cacheCreationTokens ?? 0) > 0);
  const clockSubscribe = useCallback(
    (listener: () => void) => (ticking ? subscribe(listener) : noopSubscribe()),
    [ticking],
  );
  const nowMs = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!props.hud) return null;
  const view = presentCacheHud(props.hud, ticking ? nowMs : Date.now());
  const color =
    view.state === "expiring"
      ? "text-warning-foreground"
      : view.state === "cold" || view.state === "unknown"
        ? "text-secondary-label"
        : "text-foreground";
  const content = (
    <span className={`truncate font-mono text-xs tabular-nums ${color}`}>
      {view.cacheText} · {view.contextText}
    </span>
  );
  if (props.compact)
    return (
      <span
        className="block min-w-0 truncate"
        title={view.description}
        aria-label={view.description}
      >
        {content}
      </span>
    );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="min-w-0 text-left"
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
