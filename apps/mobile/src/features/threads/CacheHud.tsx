import { useCallback, useSyncExternalStore } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Alert, AppState, Pressable } from "react-native";
import type { OrchestrationV2CacheHud } from "@t3tools/contracts";
import { presentCacheHud } from "@t3tools/shared/cacheHud";
import { AppText as Text } from "../../components/AppText";

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
let appSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
const listeners = new Set<() => void>();
function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}
function resume() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (listeners.size && AppState.currentState === "active") {
    tick();
    timer = setInterval(tick, 15_000);
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    appSubscription = AppState.addEventListener("change", resume);
    resume();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = undefined;
      appSubscription?.remove();
      appSubscription = undefined;
    }
  };
}
const snapshot = () => now;

export function CacheHud(props: {
  hud: OrchestrationV2CacheHud | null | undefined;
  compact?: boolean;
}) {
  const focused = useIsFocused();
  const ticking =
    !!props.hud?.ttlMs &&
    Date.parse(props.hud.usage.updatedAt) + props.hud.ttlMs > Date.now() &&
    ((props.hud.usage.cachedInputTokens ?? 0) > 0 ||
      (props.hud.usage.cacheCreationTokens ?? 0) > 0);
  const clockSubscribe = useCallback(
    (listener: () => void) => (focused && ticking ? subscribe(listener) : () => {}),
    [focused, ticking],
  );
  const nowMs = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!props.hud) return null;
  const view = presentCacheHud(props.hud, ticking ? nowMs : Date.now());
  const color =
    view.state === "expiring"
      ? "text-warning-foreground"
      : view.state === "cold" || view.state === "unknown"
        ? "text-foreground-muted"
        : "text-foreground";
  const content = (
    <Text
      className={`font-mono text-xs ${color}`}
      numberOfLines={1}
      accessibilityLabel={view.description}
    >
      {view.cacheText} · {view.contextText}
    </Text>
  );
  if (props.compact) return content;
  return (
    <Pressable
      className="px-4 py-1.5"
      accessibilityRole="button"
      accessibilityLabel="Cache and context details"
      onPress={() => Alert.alert("Cache and context", view.description)}
    >
      {content}
    </Pressable>
  );
}
