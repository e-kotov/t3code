import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { runtime } from "../../lib/runtime";
import {
  openDirectNotificationBatterySettings,
  setDirectNotificationsEnabled,
  setNotifyOnSubagentCompletion,
  supportsDirectNotifications,
  supportsSubagentCompletionNotifications,
  useDirectNotificationStatus,
  useDirectNotificationsEnabled,
  useNotifyOnSubagentCompletion,
} from "../agent-awareness/directNotifications";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/** Android notifications straight from paired servers, for builds without T3 Connect. */
export function DirectSettingsNotificationsRouteScreen() {
  const enabled = useDirectNotificationsEnabled();
  const notifySubagentCompletion = useNotifyOnSubagentCompletion();
  const [busy, setBusy] = useState(false);
  const status = useDirectNotificationStatus();
  const toggle = async (value: boolean) => {
    setBusy(true);
    const result = await settlePromise(async () => {
      if (value) {
        const permission = await runtime.runPromise(requestAgentNotificationPermission);
        if (permission.type !== "granted") return false;
      }
      setDirectNotificationsEnabled(value);
      return true;
    });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      Dialog.alert("Couldn't change notifications", "Reopen T3 Code and try again.");
    } else if (!result.value) {
      Dialog.alert(
        "Notifications are disabled",
        "Allow notifications for T3 Code in Android Settings.",
      );
    }
  };
  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4 pb-8"
      >
        <SettingsSection title="Direct server notifications">
          <SettingsSwitchRow
            icon="bell.badge"
            label="Direct notifications"
            value={enabled}
            disabled={busy || !supportsDirectNotifications()}
            subtitle="Completion, approval and input alerts from your paired servers. No cloud account."
            onValueChange={(value) => {
              void toggle(value);
            }}
          />
          <SettingsSwitchRow
            icon="bell.badge"
            label="Subagent completion alerts"
            value={notifySubagentCompletion}
            disabled={!enabled || !supportsSubagentCompletionNotifications()}
            subtitle="Get an alert when a subagent finishes. Input, approval and error alerts always come through."
            onValueChange={setNotifyOnSubagentCompletion}
          />
          <SettingsRow
            icon="bolt.circle"
            label="Android battery settings"
            onPress={openDirectNotificationBatterySettings}
          />
        </SettingsSection>
        <Text className="text-sm text-foreground-muted">{status}</Text>
        <Text className="text-sm text-foreground-muted">
          Keeps a connection notification visible while listening. Keep your SSH tunnel running. For
          screen-off delivery, exclude both T3 Code and your tunnel app from battery optimization.
          Reopen T3 after Android stops it or after restarting your phone. Force stopping T3 stops
          alerts.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
