import { useGT } from "gt-react-native";

import { AppText } from "../../components/ui/AppText";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

export function ScheduledTaskSearchOptions({
  includePrompts,
  onIncludePromptsChange,
}: {
  readonly includePrompts: boolean;
  readonly onIncludePromptsChange: (includePrompts: boolean) => void;
}) {
  const gt = useGT();
  return (
    <SettingsSection>
      <SettingsSwitchRow
        label={gt("Search prompts too")}
        value={includePrompts}
        onValueChange={onIncludePromptsChange}
      />
    </SettingsSection>
  );
}

export function ScheduledTaskSearchProject({ title }: { readonly title: string | undefined }) {
  if (title === undefined) return null;
  return (
    <AppText className="text-sm text-foreground-muted" numberOfLines={1}>
      {title}
    </AppText>
  );
}
