import { AppText as Text } from "../../components/ui/AppText";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { CacheHud } from "./CacheHud";
import { ThreadCachePolicyControl } from "./ThreadCachePolicyControl";

export function CacheThreadTitle(props: {
  readonly thread: Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "cacheHud" | "modelSelection"
  >;
  readonly children: ReactNode;
}) {
  return (
    <>
      <View className="mt-1 flex-row items-center">
        <View className="min-w-0 flex-1">{props.children}</View>
        <ThreadCachePolicyControl thread={props.thread} />
      </View>
      <CacheHud hud={props.thread.cacheHud} compact />
    </>
  );
}

export function CacheThreadRowTitle({
  thread,
  ...props
}: ComponentProps<typeof Text> & {
  readonly thread: ComponentProps<typeof CacheThreadTitle>["thread"];
}) {
  return (
    <View className="min-w-0 flex-1">
      <CacheThreadTitle thread={thread}>
        <Text {...props} />
      </CacheThreadTitle>
    </View>
  );
}
