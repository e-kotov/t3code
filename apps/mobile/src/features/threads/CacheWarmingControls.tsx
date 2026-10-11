import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { AppText as Text } from "../../components/AppText";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { Pressable, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";

const EXPLANATION =
  "May send a short visible, billable cache-warm turn near cache expiry when enabled for this environment and conversation.";

export function CacheWarmingEnvironmentControl(props: {
  readonly environmentId: EnvironmentId | null;
}) {
  if (props.environmentId === null) return null;
  return <EnvironmentControl environmentId={props.environmentId} />;
}

function EnvironmentControl(props: { readonly environmentId: EnvironmentId }) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "prompt cache warming setting",
  });
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const enabled = settings?.cacheWarmingEnabled ?? false;
  return (
    <View className="h-9 flex-row items-center gap-2 rounded-full px-2">
      <View className="min-w-0">
        <Text className="text-xs">Warm cache</Text>
        <Text className="text-[9px] text-muted-foreground">
          This server · Codex/Claude · billable turns
        </Text>
      </View>
      <ThemedSwitch
        accessibilityLabel="Enable prompt cache warming for this environment"
        accessibilityHint={EXPLANATION}
        disabled={!canWrite}
        value={enabled}
        onValueChange={(value) =>
          void updateSettings({
            environmentId: props.environmentId,
            input: { patch: { cacheWarmingEnabled: value } },
          })
        }
      />
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
      accessibilityRole="checkbox"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel={`${enabled ? "Disable" : "Enable"} prompt cache warming for this conversation`}
      accessibilityHint={
        unsupportedProvider
          ? "Prompt cache warming currently supports Codex and Claude only."
          : `${EXPLANATION} This opt-in remains saved while the environment toggle is off.`
      }
      disabled={disabled}
      className="ml-1 min-h-8 min-w-8 items-center justify-center rounded-full"
      onPress={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <View
        className={`h-[18px] w-[18px] items-center justify-center rounded border ${
          enabled ? "border-primary bg-primary" : "border-muted-foreground/50 bg-transparent"
        } ${disabled ? "opacity-40" : ""}`}
      >
        {unsupportedProvider ? (
          <Text className="text-[8px] leading-3 text-muted-foreground">N/A</Text>
        ) : enabled ? (
          <Text className="text-[11px] leading-4 text-primary-foreground">✓</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
