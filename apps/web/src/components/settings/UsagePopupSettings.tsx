import { useState } from "react";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import {
  MIN_USAGE_POPUP_HOVER_DELAY_MS,
  MAX_USAGE_POPUP_HOVER_DELAY_MS,
} from "../../usageCompact/usagePopupConstants";

export function UsagePopupSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const [delayDraft, setDelayDraft] = useState(String(settings.usagePopupHoverDelayMs));
  const [delayDraftSource, setDelayDraftSource] = useState(settings.usagePopupHoverDelayMs);
  if (delayDraftSource !== settings.usagePopupHoverDelayMs) {
    setDelayDraftSource(settings.usagePopupHoverDelayMs);
    setDelayDraft(String(settings.usagePopupHoverDelayMs));
  }

  const commitDelay = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDelayDraft(String(settings.usagePopupHoverDelayMs));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDelayDraft(String(settings.usagePopupHoverDelayMs));
      return;
    }
    const rounded = Math.round(parsed);
    const clamped = Math.max(
      MIN_USAGE_POPUP_HOVER_DELAY_MS,
      Math.min(MAX_USAGE_POPUP_HOVER_DELAY_MS, rounded),
    );
    if (clamped !== settings.usagePopupHoverDelayMs) {
      updateSettings({ usagePopupHoverDelayMs: clamped });
    }
    setDelayDraft(String(clamped));
  };

  return (
    <>
      <SettingsRow
        title="Usage quota preview"
        description="Show remaining model quota details when hovering over the header usage indicator."
        resetAction={
          settings.usagePopupEnabled !== DEFAULT_CLIENT_SETTINGS.usagePopupEnabled ? (
            <SettingResetButton
              label="usage quota preview"
              onClick={() =>
                updateSettings({ usagePopupEnabled: DEFAULT_CLIENT_SETTINGS.usagePopupEnabled })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.usagePopupEnabled}
            onCheckedChange={(checked) => updateSettings({ usagePopupEnabled: Boolean(checked) })}
            aria-label="Usage quota preview"
          />
        }
      />
      <SettingsRow
        title="Usage popup hover delay"
        description="Delay in milliseconds before the quota details popup opens on hover."
        resetAction={
          settings.usagePopupEnabled &&
          settings.usagePopupHoverDelayMs !== DEFAULT_CLIENT_SETTINGS.usagePopupHoverDelayMs ? (
            <SettingResetButton
              label="usage popup hover delay"
              onClick={() =>
                updateSettings({
                  usagePopupHoverDelayMs: DEFAULT_CLIENT_SETTINGS.usagePopupHoverDelayMs,
                })
              }
            />
          ) : null
        }
        control={
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              type="number"
              min={MIN_USAGE_POPUP_HOVER_DELAY_MS}
              max={MAX_USAGE_POPUP_HOVER_DELAY_MS}
              step={50}
              disabled={!settings.usagePopupEnabled}
              className="w-24"
              value={delayDraft}
              onChange={(event) => setDelayDraft(event.target.value)}
              onBlur={() => commitDelay(delayDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              aria-label="Usage popup hover delay in milliseconds"
            />
            <span className="text-xs text-muted-foreground">ms</span>
          </div>
        }
      />
    </>
  );
}
