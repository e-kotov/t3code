import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import type { SettingsTarget } from "./settings-environment-filter";

export function AutomationDestinationSetting({
  environment,
}: {
  readonly environment: SettingsTarget;
}) {
  const canWrite = useEnvironmentScope(environment.environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: true });
  return (
    <SettingsSwitchRow
      label="Use current thread for agent-created tasks"
      subtitle="Off starts each run in a new thread. Existing tasks are unchanged."
      value={environment.serverConfig.settings.agentScheduledTasksUseCurrentThread}
      disabled={!canWrite}
      onValueChange={(value) => {
        void update({
          environmentId: environment.environmentId,
          input: { patch: { agentScheduledTasksUseCurrentThread: value } },
        });
      }}
    />
  );
}
