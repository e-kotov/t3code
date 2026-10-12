import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { AppText as Text } from "../../components/AppText";
import { Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

const EXPLANATION =
  "May send a short visible, billable cache-warm turn near cache expiry when enabled for this conversation.";

export function CacheWarmingEnvironmentControl(props: {
  readonly environmentId: EnvironmentId | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  if (props.environmentId === null) return null;
  return <EnvironmentControl environmentId={props.environmentId} threads={props.threads} />;
}

function EnvironmentControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const hotThreadIds = props.threads
    .filter((thread) => {
      const hud = thread.cacheHud;
      return (
        thread.environmentId === props.environmentId &&
        thread.archivedAt === null &&
        hud &&
        (hud.driver === "codex" || hud.driver === "claudeAgent") &&
        (hud.usage.cachedInputTokens ?? 0) + (hud.usage.cacheCreationTokens ?? 0) > 0 &&
        hud.ttlMs !== undefined &&
        Date.now() - Date.parse(hud.usage.updatedAt) < hud.ttlMs
      );
    })
    .map((thread) => thread.id);
  const enabled =
    hotThreadIds.length > 0 &&
    hotThreadIds.every((id) => settings?.cacheWarmingSessions?.[id] === true);
  return (
    <View className="h-9 flex-row items-center gap-2 rounded-full px-2">
      <View className="min-w-0">
        <Text className="text-xs">Warm cache</Text>
        <Text className="text-[9px] text-muted-foreground">
          This server · Codex/Claude · billable turns
        </Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={`${enabled ? "Disable" : "Enable"} warming for all hot conversations`}
        accessibilityHint={`${EXPLANATION} Updates each hot conversation's toggle.`}
        accessibilityState={{ checked: enabled, disabled: !canWrite || hotThreadIds.length === 0 }}
        disabled={!canWrite || hotThreadIds.length === 0}
        onPress={() => {
          const value = !enabled;
          void updateSettings({
            environmentId: props.environmentId,
            input: {
              patch: {
                cacheWarmingSessions: Object.fromEntries(hotThreadIds.map((id) => [id, value])),
              },
            },
          });
        }}
        className={`rounded-full border px-3 py-1.5 ${enabled ? "border-primary bg-primary" : "border-border bg-surface"} ${!canWrite || hotThreadIds.length === 0 ? "opacity-40" : ""}`}
      >
        <Text className={`text-xs ${enabled ? "text-primary-foreground" : "text-foreground"}`}>
          {enabled ? "Warm all: On" : "Warm all: Off"}
        </Text>
      </Pressable>
    </View>
  );
}

export function CacheWarmingThreadControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly driver?: string | null | undefined;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "conversation prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const enabled = settings?.cacheWarmingSessions?.[props.threadId] === true;
  const unsupportedProvider = props.driver !== "codex" && props.driver !== "claudeAgent";
  const disabled = !canWrite || unsupportedProvider;
  const toggle = () => {
    void updateSettings({
      environmentId: props.environmentId,
      input: { patch: { cacheWarmingSessions: { [props.threadId]: !enabled } } },
    });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: enabled }}
      accessibilityLabel={`${enabled ? "Disable" : "Enable"} cache warming for this conversation`}
      accessibilityHint={
        unsupportedProvider
          ? "Prompt cache warming currently supports Codex and Claude only."
          : EXPLANATION
      }
      disabled={disabled}
      className={`ml-2 min-h-8 rounded-full border px-2.5 items-center justify-center ${enabled ? "border-primary bg-primary" : "border-border bg-transparent"} ${disabled ? "opacity-40" : ""}`}
      onPress={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <Text
        className={`text-[11px] font-t3-medium ${enabled ? "text-primary-foreground" : "text-foreground-muted"}`}
      >
        {unsupportedProvider ? "N/A" : enabled ? "Warm on" : "Warm off"}
      </Text>
    </Pressable>
  );
}
