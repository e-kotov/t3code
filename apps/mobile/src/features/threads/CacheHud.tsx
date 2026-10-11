import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Alert, AppState, Pressable } from "react-native";
import type { OrchestrationV2CacheHud } from "@t3tools/contracts";
import { createCacheHudClock, createCacheHudSnapshot } from "@t3tools/shared/cacheHud";
import { AppText as Text } from "../../components/AppText";

const subscribe = createCacheHudClock(
  () => AppState.currentState === "active",
  (refresh) => {
    const subscription = AppState.addEventListener("change", refresh);
    return () => subscription.remove();
  },
);

export function CacheHud(props: {
  hud: OrchestrationV2CacheHud | null | undefined;
  compact?: boolean;
}) {
  const focused = useIsFocused();
  const hud = props.hud;
  const expiry =
    hud?.ttlMs !== undefined &&
    ((hud.usage.cachedInputTokens ?? 0) > 0 || (hud.usage.cacheCreationTokens ?? 0) > 0)
      ? Date.parse(hud.usage.updatedAt) + hud.ttlMs
      : null;
  const clockSubscribe = useCallback(
    (listener: () => void) => (focused && expiry !== null ? subscribe(expiry, listener) : () => {}),
    [focused, expiry],
  );
  const snapshot = useMemo(() => createCacheHudSnapshot(hud), [hud]);
  const view = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!view) return null;
  const color =
    view.state === "expiring"
      ? "text-warning-foreground font-semibold"
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
