import type { ReactNode } from "react";
import { View } from "react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { CacheWarmingEnvironmentControl } from "../threads/CacheWarmingControls";
import { resolveCacheWarmingEnvironmentId } from "../threads/cacheWarmingTarget";

export function ConversationListHeader(props: {
  readonly children: ReactNode;
  readonly view: {
    readonly selectedEnvironmentId: EnvironmentId | null;
    readonly environments: Parameters<typeof resolveCacheWarmingEnvironmentId>[1];
    readonly threads: readonly EnvironmentThreadShell[];
  };
}) {
  return <View>
    {props.children}
    <View className="px-3 py-1">
      <CacheWarmingEnvironmentControl
        environmentId={resolveCacheWarmingEnvironmentId(props.view.selectedEnvironmentId, props.view.environments)}
        threads={props.view.threads}
      />
    </View>
  </View>;
}
