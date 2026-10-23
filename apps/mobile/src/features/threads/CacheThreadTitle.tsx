import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ReactNode } from "react";
import { View } from "react-native";
import { CacheHud } from "./CacheHud";
import { CacheWarmingThreadControl } from "./CacheWarmingControls";

export function CacheThreadTitle(props: {
  readonly thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "cacheHud">;
  readonly children: ReactNode;
}) {
  return (
    <>
      <View className="mt-1 flex-row items-center">
        <View className="min-w-0 flex-1">{props.children}</View>
        <CacheWarmingThreadControl
          environmentId={props.thread.environmentId}
          threadId={props.thread.id}
          driver={props.thread.cacheHud?.driver}
        />
      </View>
      <CacheHud hud={props.thread.cacheHud} compact />
    </>
  );
}
