import { T, useGT } from "gt-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function TypeToCiteSetting() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("typing-with-selection")}
      description={gt("Choose what typing or pasting does while Cite is available.")}
      resetAction={
        settings.typingWithSelection !== DEFAULT_UNIFIED_SETTINGS.typingWithSelection ? (
          <SettingResetButton
            ariaLabel={gt("Reset typing with text selected to default")}
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
          <SelectTrigger size="sm" aria-label={gt("Typing with text selected")}>
            <SelectValue>
              {settings.typingWithSelection === "cite"
                ? gt("Cites the selection")
                : gt("Goes to the composer")}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="composer">
              <T>Goes to the composer</T>
            </SelectItem>
            <SelectItem value="cite">
              <T>Cites the selection</T>
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}
