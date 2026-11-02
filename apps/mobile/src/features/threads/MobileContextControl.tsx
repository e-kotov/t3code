import { AuthOrchestrationOperateScope, CommandId, MessageId } from "@t3tools/contracts";
import type { OrchestrationV2CacheHud } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { presentCacheHud } from "@t3tools/shared/cacheHud";
import { Pressable } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { ThreadCachePolicyMenu as Menu } from "./ThreadCachePolicyMenu";

export function MobileContextControl({
  hud,
  thread,
}: {
  readonly hud: OrchestrationV2CacheHud | null | undefined;
  readonly thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "modelSelection">;
}) {
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const { themeVariables: colors } = useAppearancePreferences();
  if (!hud) return null;
  const view = presentCacheHud(hud, 0);
  const percent = view.contextPercentage;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const count = `${hud.usage.usedTokens.toLocaleString()} / ${hud.usage.maxTokens?.toLocaleString() ?? "unknown"} tokens${percent === null ? "" : ` · ${percent}% used`}`;
  const compact = async () => {
    if (!readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) return;
    const metadata = makeQueuedMessageMetadata();
    try {
      await enqueueThreadOutboxMessage({
        environmentId: thread.environmentId,
        threadId: thread.id,
        messageId: MessageId.make(metadata.messageId),
        commandId: CommandId.make(metadata.commandId),
        text: "/compact",
        attachments: [],
        dispatchMode: "queue",
        createdAt: metadata.createdAt,
      });
    } catch (error) {
      Dialog.alert(
        "Could not queue compaction",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  };
  return (
    <Menu
      title="Context window"
      actions={[
        { id: "usage", title: count, attributes: { disabled: true } },
        {
          id: "compact",
          title: "Compact now",
          subtitle: "Summarize this conversation to free context",
          attributes: { disabled: !canOperate },
        },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "compact") void compact();
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Context: ${count}`}
        accessibilityHint="Show context details and compaction options"
        className="flex-row items-center gap-1 rounded-md px-1 py-2"
      >
        <Svg width={16} height={16} viewBox="0 0 16 16">
          <Circle
            cx={8}
            cy={8}
            r={radius}
            stroke={colors["--color-foreground-muted"]}
            strokeWidth={2}
            fill="none"
            opacity={0.3}
          />
          {percent !== null ? (
            <Circle
              cx={8}
              cy={8}
              r={radius}
              stroke={colors["--color-foreground"]}
              strokeWidth={2}
              fill="none"
              strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
              rotation={-90}
              origin="8, 8"
            />
          ) : null}
        </Svg>
        <Text className="font-mono text-xs text-foreground" numberOfLines={1}>
          {view.contextText}
        </Text>
      </Pressable>
    </Menu>
  );
}
