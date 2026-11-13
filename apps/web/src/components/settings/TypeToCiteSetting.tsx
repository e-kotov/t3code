import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function TypeToCiteSetting() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("typing-with-selection")}
      description="Choose what typing or pasting does while Cite is available."
      resetAction={
        settings.typingWithSelection !== DEFAULT_UNIFIED_SETTINGS.typingWithSelection ? (
          <SettingResetButton
            label="typing with text selected"
            onClick={() =>
              updateSettings({
                typingWithSelection: DEFAULT_UNIFIED_SETTINGS.typingWithSelection,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.typingWithSelection}
          onValueChange={(value) => {
            if (value === "composer" || value === "cite")
              updateSettings({ typingWithSelection: value });
          }}
        >
          <SelectTrigger size="sm" aria-label="Typing with text selected">
            <SelectValue>
              {settings.typingWithSelection === "cite"
                ? "Cites the selection"
                : "Goes to the composer"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="composer">Goes to the composer</SelectItem>
            <SelectItem value="cite">Cites the selection</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
