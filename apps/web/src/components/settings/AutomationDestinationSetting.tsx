import { useGT } from "gt-react";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function AutomationDestinationSetting() {
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      title={gt("Use the current thread for agent-created tasks")}
      description={gt(
        "Off starts each run in a new thread. On posts runs in the thread where the agent created the task. Existing tasks are unchanged.",
      )}
      serverScoped
      settingKeys={["agentScheduledTasksUseCurrentThread"]}
      control={
        <Switch
          aria-label={gt("Use the current thread for agent-created tasks")}
          checked={settings.agentScheduledTasksUseCurrentThread}
          onCheckedChange={(checked) =>
            updateSettings({ agentScheduledTasksUseCurrentThread: Boolean(checked) })
          }
        />
      }
    />
  );
}
