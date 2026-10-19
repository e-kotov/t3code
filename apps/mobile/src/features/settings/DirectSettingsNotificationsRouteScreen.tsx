import { useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { runtime } from "../../lib/runtime";
import {
  openDirectNotificationBatterySettings,
  setDirectNotificationsEnabled,
  supportsDirectNotifications,
  useDirectNotificationStatus,
  useDirectNotificationsEnabled,
} from "../agent-awareness/directNotifications";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/** Android notifications straight from paired servers, for builds without T3 Connect. */
export function DirectSettingsNotificationsRouteScreen() {
  const enabled = useDirectNotificationsEnabled();
  const [busy, setBusy] = useState(false);
  const status = useDirectNotificationStatus();
  const toggle = async (value: boolean) => {
    setBusy(true);
    try {
      if (value) {
        const permission = await runtime.runPromise(requestAgentNotificationPermission);
        if (permission.type !== "granted") {
          Dialog.alert(
            "Notifications are disabled",
            "Allow notifications for T3 Code in Android Settings.",
          );
          return;
        }
      }
      setDirectNotificationsEnabled(value);
    } catch {
      Dialog.alert("Couldn't change notifications", "Reopen T3 Code and try again.");
    } finally {
      setBusy(false);
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
