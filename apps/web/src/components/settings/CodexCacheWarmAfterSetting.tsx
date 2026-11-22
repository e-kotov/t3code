import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import {
  resolveCodexCacheWarmAfterMinutes,
  resolveNeonCacheWarmAfterMinutes,
  supportsCodexCacheWarmAfter,
  supportsNeonCacheWarming,
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

const NEON_WARM_AFTER_OPTIONS = [25, 40, 50, 55] as const;

export function CacheWarmAfterSettings() {
  return (
    <>
      <CodexCacheWarmAfterSetting />
      <NeonCacheWarmAfterSetting />
    </>
  );
}

export function CodexCacheWarmAfterSetting() {
  return <CacheWarmAfterSetting provider="codex" />;
}

export function NeonCacheWarmAfterSetting() {
  return <CacheWarmAfterSetting provider="neon" />;
}

/** The Providers panel can render without a settings scope, as its tests do. */
function CacheWarmAfterSetting(props: { readonly provider: "codex" | "neon" }) {
  return useOptionalSettingsScope() === null ? null : <ScopedCacheWarmAfterSetting {...props} />;
}

function ScopedCacheWarmAfterSetting({ provider }: { readonly provider: "codex" | "neon" }) {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const { connectedEnvironments, targets } = useSettingsScope();
  const updateSettings = useUpdateScopedSettings();
  const neon = provider === "neon";
  const key = neon ? "neonCacheWarmAfterMinutes" : "codexCacheWarmAfterMinutes";
  const defaultMinutes = DEFAULT_SERVER_SETTINGS[key];
  const supports = neon ? supportsNeonCacheWarming : supportsCodexCacheWarmAfter;
  const resolve = neon ? resolveNeonCacheWarmAfterMinutes : resolveCodexCacheWarmAfterMinutes;
  const options: ReadonlyArray<number> = neon
    ? NEON_WARM_AFTER_OPTIONS
    : CODEX_WARM_AFTER_OPTIONS.map((option) => option.minutes);
  const update = (minutes: number) =>
    updateSettings(
      neon ? { neonCacheWarmAfterMinutes: minutes } : { codexCacheWarmAfterMinutes: minutes },
    );
  const environmentById = new Map(
    connectedEnvironments.map((environment) => [environment.environmentId, environment] as const),
  );
  const unsupportedEnvironments = connectedEnvironments.filter(
    (environment) => !supports(environment.serverConfig),
  );
  const allSupported = connectedEnvironments.length > 0 && unsupportedEnvironments.length === 0;
  const effectiveValues =
    targets.length > 0
      ? targets.map((candidate) =>
          resolve({
            environment: environmentById.get(candidate.environmentId)?.serverConfig?.environment,
            settings: candidate.settings,
          }),
        )
      : connectedEnvironments.length > 0
        ? connectedEnvironments.map((environment) => resolve(environment.serverConfig))
        : [settings[key]];
  const mixed = new Set(effectiveValues.filter((minutes) => minutes !== undefined)).size > 1;
  const current = effectiveValues[0] ?? settings[key];
  const label = (minutes: number) => {
    const option = CODEX_WARM_AFTER_OPTIONS.find((entry) => entry.minutes === minutes);
    return !neon && option ? m(option.label) : gt("{minutes} min", { minutes });
  };
  return (
    <SettingsRow
      serverScoped
      settingKeys={[key]}
      mixed={mixed}
      {...setting(neon ? "neon-cache-warm-after" : "codex-cache-warm-after")}
      description={
        neon
          ? gt(
              "For Neon conversations set to Keep warm. T3 sends up to one warm turn per user turn.",
            )
          : gt(
              "For conversations set to Keep warm. Codex does not report how long its prompt cache lasts, so the warm turn is sent after this much idle time and skipped once five more minutes pass. Claude uses its reported cache lifetime.",
            )
      }
      status={
        unsupportedEnvironments.length === 0
          ? undefined
          : neon
            ? gt("Upgrade T3 Code on {environments} to warm Neon.", {
                environments: unsupportedEnvironments.map((env) => env.label).join(", "),
              })
            : gt(
                "Upgrade T3 Code on {environments} to change this setting; older servers still warm Codex after 55 minutes.",
                { environments: unsupportedEnvironments.map((env) => env.label).join(", ") },
              )
      }
      resetAction={
        allSupported && current !== defaultMinutes ? (
          <SettingResetButton
            ariaLabel={
              neon ? gt("Reset Neon warm time to default") : gt("Reset Codex warm time to default")
            }
            onClick={() => update(defaultMinutes)}
          />
        ) : null
      }
      control={
        <Select
          disabled={!allSupported}
          value={mixed ? null : String(current)}
          onValueChange={(value) => {
            if (!allSupported) return;
            const minutes = options.find((option) => String(option) === value);
            if (minutes !== undefined) update(minutes);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={neon ? gt("Warm Neon after") : gt("Warm Codex after")}
          >
            <SelectValue>
              {(value: string | null) => (value === null ? gt("Mixed") : label(Number(value)))}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {options.map((minutes) => (
              <SelectItem hideIndicator key={minutes} value={String(minutes)}>
                {label(minutes)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
