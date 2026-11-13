import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type SettleNavigation = ClientSettings["settleNavigation"];

const SETTLE_NAVIGATION_LABELS: Record<SettleNavigation, string> = {
  stay: "Stay on settled thread",
  "new-chat": "Open a new chat",
  "next-thread": "Open next thread",
};
const SETTLE_NAVIGATION_OPTIONS: readonly SettleNavigation[] = ["stay", "new-chat", "next-thread"];

export function SettleNavigationSetting() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      title="After settling the open thread"
      description="Staying or opening a new chat leaves other threads unread. Settling a thread you are not viewing never changes the open view."
      resetAction={
        settings.settleNavigation !== DEFAULT_CLIENT_SETTINGS.settleNavigation ? (
          <SettingResetButton
            label="after settling"
            onClick={() =>
              updateSettings({ settleNavigation: DEFAULT_CLIENT_SETTINGS.settleNavigation })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.settleNavigation}
          onValueChange={(value) => {
            const choice = SETTLE_NAVIGATION_OPTIONS.find((option) => option === value);
            if (choice) updateSettings({ settleNavigation: choice });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="After settling">
            <SelectValue>{SETTLE_NAVIGATION_LABELS[settings.settleNavigation]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {SETTLE_NAVIGATION_OPTIONS.map((option) => (
              <SelectItem hideIndicator key={option} value={option}>
                {SETTLE_NAVIGATION_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
