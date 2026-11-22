import { AuthSettingsWriteScope, type ServerSettingsPatch } from "@t3tools/contracts";
import { IDLE_THREAD_PROVIDERS, machineIdlePolicy } from "@t3tools/shared/threadCachePolicy";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import type { SettingsTarget } from "./settings-environment-filter";

export function MachineIdleSettings({ environment }: { readonly environment: SettingsTarget }) {
  const gt = useGT();
  const { environmentId, serverConfig } = environment;
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, {
    label: "idle thread settings",
  });
  if (!serverConfig.environment.capabilities?.machineIdlePolicy) return null;
  const settings = serverConfig.settings;
  const policy = machineIdlePolicy(settings);
  const configured = settings.machineIdlePolicy !== undefined;
  const save = (patch: NonNullable<ServerSettingsPatch["machineIdlePolicy"]>) => {
    if (!canWrite) return;
    void update({ environmentId, input: { patch: { machineIdlePolicy: patch } } });
  };
  const modes = [
    { value: "off", label: gt("Off") },
    { value: "warm", label: gt("Keep warm") },
    { value: "compact", label: gt("Compact") },
  ] as const;
  return (
    <View className="gap-3 p-4">
      <Text className="font-semibold">{gt("While idle")}</Text>
      <View className="flex-row gap-2" accessibilityRole="radiogroup">
        {modes.map(({ value, label }) => {
          const selected = configured && value === policy.mode;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !canWrite }}
              disabled={!canWrite}
              className={
                selected
                  ? "min-h-11 flex-1 justify-center rounded-lg bg-primary"
                  : "min-h-11 flex-1 justify-center rounded-lg border border-border"
              }
              onPress={() => save({ mode: value })}
            >
              <Text className={selected ? "text-center text-primary-foreground" : "text-center"}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!configured ? (
        <Text className="text-sm text-foreground-muted">
          {gt("Choose a mode to replace this machine’s current idle rules.")}
        </Text>
      ) : policy.mode === "warm" ? (
        <Text className="text-sm text-foreground-muted">
          {gt("Send one short request per idle thread. This uses quota.")}
        </Text>
      ) : null}
      {configured &&
        IDLE_THREAD_PROVIDERS.map(({ driver, label }) => (
          <View key={driver} className="gap-2 border-t border-border pt-3">
            <Text className="font-medium">{label}</Text>
            <IdleNumber
              key={`idle-${policy[driver].idleMinutes}`}
              label={gt("Idle time (min)")}
              provider={label}
              value={policy[driver].idleMinutes}
              max={720}
              editable={canWrite && policy.mode !== "off"}
              onSave={(idleMinutes) => save({ [driver]: { idleMinutes } })}
            />
            {policy.mode === "compact" ? (
              <IdleNumber
                key={`context-${policy[driver].minContextTokens}`}
                label={gt("Minimum context (k tokens)")}
                provider={label}
                value={policy[driver].minContextTokens / 1_000}
                max={10_000}
                editable={canWrite}
                onSave={(value) => save({ [driver]: { minContextTokens: value * 1_000 } })}
              />
            ) : null}
          </View>
        ))}
    </View>
  );
}

function IdleNumber(props: {
  readonly label: string;
  readonly provider: string;
  readonly value: number;
  readonly max: number;
  readonly editable: boolean;
  readonly onSave: (value: number) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(String(props.value));
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="text-foreground-muted">{props.label}</Text>
      <TextInput
        accessibilityLabel={gt("{provider} · {setting}", {
          provider: props.provider,
          setting: props.label,
        })}
        editable={props.editable}
        className="min-w-20 rounded-lg border border-border px-3 py-2 text-right text-foreground"
        keyboardType="number-pad"
        value={draft}
        onChangeText={setDraft}
        onEndEditing={({ nativeEvent }) => {
          const value = Number(nativeEvent.text);
          if (!Number.isInteger(value) || value < 1 || value > props.max) {
            setDraft(String(props.value));
            return;
          }
          setDraft(String(value));
          if (value !== props.value) props.onSave(value);
        }}
      />
    </View>
  );
}
