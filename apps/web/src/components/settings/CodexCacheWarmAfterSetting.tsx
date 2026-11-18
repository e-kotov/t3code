import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import {
  resolveCodexCacheWarmAfterMinutes,
  supportsCodexCacheWarmAfter,
} from "@t3tools/shared/cacheHud";
import { msg, useGT, useMessages } from "gt-react";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

// Measured Codex resumes kept their cache in about four of five cases up to two hours idle,
// then fell away; the presets stop short of that cliff.
const CODEX_WARM_AFTER_OPTIONS = [
  { minutes: 25, label: msg("25 min") },
  { minutes: 55, label: msg("55 min (previous default)") },
  { minutes: 85, label: msg("1 h 25 min") },
  { minutes: 115, label: msg("1 h 55 min (recommended)") },
  { minutes: 175, label: msg("2 h 55 min") },
] as const;

/** The Providers panel can render without a settings scope, as its tests do; this row needs one. */
export function CodexCacheWarmAfterSetting() {
  return useOptionalSettingsScope() === null ? null : <ScopedCodexCacheWarmAfterSetting />;
}

function ScopedCodexCacheWarmAfterSetting() {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const { connectedEnvironments, targets } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const environmentById = new Map(
    connectedEnvironments.map((environment) => [environment.environmentId, environment] as const),
  );
  const unsupportedEnvironments = connectedEnvironments.filter(
    (environment) => !supportsCodexCacheWarmAfter(environment.serverConfig),
  );
  const allSupported = connectedEnvironments.length > 0 && unsupportedEnvironments.length === 0;
  const effectiveValues =
    targets.length > 0
      ? targets.map((candidate) =>
          resolveCodexCacheWarmAfterMinutes({
            environment: environmentById.get(candidate.environmentId)?.serverConfig?.environment,
            settings: candidate.settings,
          }),
        )
      : connectedEnvironments.length > 0
        ? connectedEnvironments.map((environment) =>
            resolveCodexCacheWarmAfterMinutes(environment.serverConfig),
          )
        : [settings.codexCacheWarmAfterMinutes];
  const mixed = new Set(effectiveValues).size > 1;
  const current = effectiveValues[0] ?? settings.codexCacheWarmAfterMinutes;
  const defaultMinutes = DEFAULT_SERVER_SETTINGS.codexCacheWarmAfterMinutes;
  const label = (minutes: number) => {
    const option = CODEX_WARM_AFTER_OPTIONS.find((entry) => entry.minutes === minutes);
    return option ? m(option.label) : gt("{minutes} min", { minutes });
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={["codexCacheWarmAfterMinutes"]}
      mixed={mixed}
      {...setting("codex-cache-warm-after")}
      description={gt(
        "For conversations set to Keep warm. Codex does not report how long its prompt cache lasts, so the warm turn is sent after this much idle time and skipped once five more minutes pass. Claude uses its reported cache lifetime.",
      )}
      status={
        unsupportedEnvironments.length > 0
          ? gt(
              "Upgrade T3 Code on {environments} to change this setting; older servers still warm Codex after 55 minutes.",
              { environments: unsupportedEnvironments.map((env) => env.label).join(", ") },
            )
          : undefined
      }
      resetAction={
        allSupported && current !== defaultMinutes ? (
          <SettingResetButton
            ariaLabel={gt("Reset Codex warm time to default")}
            onClick={() => updateSettings({ codexCacheWarmAfterMinutes: defaultMinutes })}
          />
        ) : null
      }
      control={
        <Select
          disabled={!allSupported}
          value={mixed ? null : String(current)}
          onValueChange={(value) => {
            if (!allSupported) return;
            const choice = CODEX_WARM_AFTER_OPTIONS.find((o) => String(o.minutes) === value);
            if (choice) updateSettings({ codexCacheWarmAfterMinutes: choice.minutes });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Warm Codex after")}>
            <SelectValue>
              {(value: string | null) => (value === null ? gt("Mixed") : label(Number(value)))}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {CODEX_WARM_AFTER_OPTIONS.map((option) => (
              <SelectItem hideIndicator key={option.minutes} value={String(option.minutes)}>
                {m(option.label)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
