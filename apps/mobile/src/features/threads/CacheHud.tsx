import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useIsFocused } from "@react-navigation/native";
import { AppState, View } from "react-native";
import type { OrchestrationV2CacheHud, ServerProviderUsageWindow } from "@t3tools/contracts";
import { createCacheHudClock, createCacheHudSnapshot } from "@t3tools/shared/cacheHud";
import { formatResetsIn } from "@t3tools/shared/usageLimits";
import { formatModelSlugName } from "@t3tools/shared/model";
import { AppText as Text } from "../../components/ui/AppText";

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
  usageWindows?: readonly ServerProviderUsageWindow[];
  modelLabel?: string;
  effortLabel?: string | null;
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
  const usageWindows =
    props.usageWindows?.filter((window) => window.kind === "session" || window.kind === "weekly") ??
    [];
  if (!view && usageWindows.length === 0 && !props.modelLabel) return null;
  const color =
    view?.state === "expiring"
      ? "text-warning-foreground font-semibold"
      : view?.state === "cold" || view?.state === "unknown"
        ? "text-foreground-muted"
        : "text-foreground";
  const content = view ? (
    <Text
      className={`min-w-0 flex-1 font-mono text-xs ${color}`}
      numberOfLines={1}
      accessibilityLabel={view.description}
    >
      {view.cacheText}
    </Text>
  ) : (
    <View className="min-w-0 flex-1" />
  );
  const windows = (
    <View className="flex-row items-center gap-2">
      {usageWindows.map((window) => {
        const label =
          window.kind === "weekly"
            ? "Week"
            : window.windowDurationMins === 300
              ? "5h"
              : window.label;
        const reset = formatResetsIn(window, Date.now())?.replace(/^resets in /, "↻");
        return (
          <Text
            key={window.id}
            className="font-mono text-[10px] text-foreground-muted"
            numberOfLines={1}
          >
            {label} {Math.max(0, 100 - Math.round(window.usedPercent))}%{reset ? ` ${reset}` : ""}
          </Text>
        );
      })}
    </View>
  );
  if (props.compact)
    return <View className="flex-row items-center gap-2 px-4 py-1.5">{content}</View>;
  const modelLabel = props.modelLabel ? formatModelSlugName(props.modelLabel) : null;
  return (
    <View className="gap-0.5 px-4 py-1.5">
      <View className="flex-row items-center gap-2">
        {content}
        {modelLabel ? (
          <View className="min-w-0 shrink items-end">
            <Text className="font-mono text-[10px] text-foreground-muted" numberOfLines={1}>
              {modelLabel}
            </Text>
            {props.effortLabel ? (
              <Text
                className="font-mono text-[10px] text-foreground-muted"
                numberOfLines={1}
                accessibilityLabel={`Model effort: ${props.effortLabel}`}
              >
                {props.effortLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {usageWindows.length > 0 ? <View className="flex-row items-center">{windows}</View> : null}
    </View>
  );
}
