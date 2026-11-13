import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { msg, T, useGT, useMessages } from "gt-react";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { searchableSetting } from "./settingsSearch";

type SettleNavigation = ClientSettings["settleNavigation"];

const SETTLE_NAVIGATION_LABELS: Record<SettleNavigation, string> = {
  stay: msg("Stay on settled thread"),
  "new-chat": msg("Open a new chat"),
  "next-thread": msg("Open next thread"),
};
const SETTLE_NAVIGATION_OPTIONS: readonly SettleNavigation[] = ["stay", "new-chat", "next-thread"];

export function SettleNavigationSetting() {
  const gt = useGT();
  const m = useMessages();
  const setting = searchableSetting("settle-navigation");
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...setting}
      title={m(setting.title)}
      description={
        <T>
          Staying or opening a new chat leaves other threads unread. Settling a thread you are not
          viewing never changes the open view.
        </T>
      }
      resetAction={
        settings.settleNavigation !== DEFAULT_CLIENT_SETTINGS.settleNavigation ? (
          <SettingResetButton
            label={gt("after settling")}
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
          <SelectTrigger size="sm" className="w-full sm:w-52" aria-label={gt("After settling")}>
            <SelectValue>{m(SETTLE_NAVIGATION_LABELS[settings.settleNavigation])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {SETTLE_NAVIGATION_OPTIONS.map((option) => (
              <SelectItem hideIndicator key={option} value={option}>
                {m(SETTLE_NAVIGATION_LABELS[option])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
