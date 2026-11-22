import type { ServerSettingsPatch } from "@t3tools/contracts";
import { IDLE_THREAD_PROVIDERS, machineIdlePolicy } from "@t3tools/shared/threadCachePolicy";
import { useGT } from "gt-react";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { CacheWarmAfterSettings } from "./CodexCacheWarmAfterSetting";
import { CompactIdleThreadsRow } from "./SettingsPanels";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettingsWriteAllowed, useUpdateScopedSettings } from "./useScopedSettings";

export function MachineIdleSettings() {
  return useOptionalSettingsScope() === null ? null : <ScopedMachineIdleSettings />;
}

function ScopedMachineIdleSettings() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const { connectedEnvironments, targets } = useSettingsScope();
  const canWrite = useScopedSettingsWriteAllowed();
  const update = useUpdateScopedSettings();
  const environment = connectedEnvironments[0];
  const settings = targets[0]?.settings;
  if (
    !connectedEnvironments.some(
      (item) => item.serverConfig?.environment.capabilities?.machineIdlePolicy,
    )
  ) {
    return (
      <>
        <CompactIdleThreadsRow />
        <CacheWarmAfterSettings />
      </>
    );
  }
  if (connectedEnvironments.length !== 1 || settings === undefined) {
    return (
      <SettingsRow
        title={gt("Idle threads")}
        description={gt("Select one machine to change its idle settings.")}
      />
    );
  }
  if (!environment?.serverConfig?.environment.capabilities?.machineIdlePolicy) return null;
  const policy = machineIdlePolicy(settings);
  const save = (patch: NonNullable<ServerSettingsPatch["machineIdlePolicy"]>) =>
    update({ machineIdlePolicy: patch });
  const labels = { off: gt("Off"), warm: gt("Keep warm"), compact: gt("Compact") };
  return (
    <>
      <SettingsRow
        {...setting("machine-idle-policy")}
        serverScoped
        settingKeys={["machineIdlePolicy"]}
        title={gt("While idle")}
        description={
          settings.machineIdlePolicy === undefined
            ? gt("Choose a mode to replace this machine’s current idle rules.")
            : policy.mode === "warm"
              ? gt("Send one short request per idle thread. This uses quota.")
              : policy.mode === "compact"
                ? gt("Compact large idle threads once when the provider supports it.")
                : gt("Take no idle action.")
        }
        control={
          <Select
            disabled={!canWrite}
            value={settings.machineIdlePolicy === undefined ? null : policy.mode}
            onValueChange={(value) => {
              if (value === "off" || value === "warm" || value === "compact") save({ mode: value });
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("While idle")}>
              <SelectValue placeholder={gt("Choose a mode")}>
                {(value: keyof typeof labels | null) =>
                  value === null ? gt("Choose a mode") : labels[value]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="off">{labels.off}</SelectItem>
              <SelectItem value="warm">{labels.warm}</SelectItem>
              <SelectItem value="compact">{labels.compact}</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {IDLE_THREAD_PROVIDERS.map(({ driver, label }) => (
        <SettingsRow
          key={driver}
          serverScoped
          managedPaths={[`machineIdlePolicy.${driver}`]}
          title={label}
          control={
            <div className="grid gap-2 sm:grid-flow-col">
              <IdleNumber
                label={gt("Idle time (min)")}
                provider={label}
                value={policy[driver].idleMinutes}
                max={720}
                disabled={
                  !canWrite || settings.machineIdlePolicy === undefined || policy.mode === "off"
                }
                onSave={(idleMinutes) => save({ [driver]: { idleMinutes } })}
              />
              {policy.mode === "compact" && settings.machineIdlePolicy !== undefined ? (
                <IdleNumber
                  label={gt("Minimum context (k tokens)")}
                  provider={label}
                  value={policy[driver].minContextTokens / 1_000}
                  max={10_000}
                  disabled={!canWrite}
                  onSave={(value) => save({ [driver]: { minContextTokens: value * 1_000 } })}
                />
              ) : null}
            </div>
          }
        />
      ))}
    </>
  );
}

function IdleNumber(props: {
  readonly label: string;
  readonly provider: string;
  readonly value: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onSave: (value: number) => void;
}) {
  const gt = useGT();
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      <Input
        key={props.value}
        type="number"
        min={1}
        max={props.max}
        step={1}
        defaultValue={props.value}
        aria-label={gt("{provider} · {setting}", {
          provider: props.provider,
          setting: props.label,
        })}
        disabled={props.disabled}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={({ currentTarget: input }) => {
          const value = input.valueAsNumber;
          if (!Number.isInteger(value) || value < 1 || value > props.max) {
            input.value = String(props.value);
            return;
          }
          if (value !== props.value) props.onSave(value);
        }}
      />
    </label>
  );
}
