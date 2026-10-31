import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import type { SettingsTarget } from "./settings-environment-filter";

export function AutomationDestinationSetting({
  environment,
  projectSelected,
}: {
  readonly environment: SettingsTarget;
  readonly projectSelected: boolean;
}) {
  const canWrite = useEnvironmentScope(environment.environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  return (
    <SettingsSwitchRow
      label="Use current thread for agent-created tasks"
      subtitle={
        projectSelected
          ? "Environment-wide setting. Select All projects to change it."
          : "Off starts each run in a new thread. Existing tasks are unchanged."
      }
      value={environment.serverConfig.settings.agentScheduledTasksUseCurrentThread}
      disabled={projectSelected || !canWrite}
      onValueChange={(value) => {
        void update({
          environmentId: environment.environmentId,
          input: { patch: { agentScheduledTasksUseCurrentThread: value } },
        });
      }}
    />
  );
}
