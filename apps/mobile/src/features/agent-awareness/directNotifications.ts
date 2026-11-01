import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import {
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceEnvironments } from "../../state/workspace";
import type { SavedRemoteConnection } from "../../lib/connection";

interface DirectNotificationsNative {
  addListener(event: "onDirectNotificationStatus", listener: () => void): { remove(): void };
  directNotificationsEnabled(): boolean;
  setDirectNotificationsEnabled(enabled: boolean): void;
  notifyOnSubagentCompletion?(): boolean;
  setNotifyOnSubagentCompletion?(enabled: boolean): void;
  updateDirectNotificationConnections(connectionsJson: string, scheme: string): void;
  directNotificationStatus(): string;
  openBatteryOptimizationSettings(): void;
}
const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<DirectNotificationsNative>("T3AgentNotifications")
    : null;
const listeners = new Set<() => void>();
let enabled = native?.directNotificationsEnabled?.() ?? false;
let notifySubagentCompletion = native?.notifyOnSubagentCompletion?.() ?? false;
let status =
  native?.directNotificationStatus?.() ??
  "Install a newer Android app to enable direct notifications";

function refreshEnabled() {
  enabled = native?.directNotificationsEnabled?.() ?? false;
  notifySubagentCompletion = native?.notifyOnSubagentCompletion?.() ?? false;
  status = native?.directNotificationStatus?.() ?? status;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const nativeSubscription = native?.addListener?.("onDirectNotificationStatus", refreshEnabled);
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") refreshEnabled();
  });
  return () => {
    listeners.delete(listener);
    subscription.remove();
    nativeSubscription?.remove();
  };
}
export function useDirectNotificationsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
export function useNotifyOnSubagentCompletion(): boolean {
  return useSyncExternalStore(subscribe, () => notifySubagentCompletion);
}
export function supportsSubagentCompletionNotifications(): boolean {
  return typeof native?.setNotifyOnSubagentCompletion === "function";
}
export function setNotifyOnSubagentCompletion(value: boolean): void {
  native?.setNotifyOnSubagentCompletion?.(value);
  refreshEnabled();
}
export function supportsDirectNotifications(): boolean {
  return typeof native?.updateDirectNotificationConnections === "function";
}
export function setDirectNotificationsEnabled(value: boolean): void {
  native?.setDirectNotificationsEnabled?.(value);
  refreshEnabled();
}
export function useDirectNotificationStatus(): string {
  return useSyncExternalStore(subscribe, () => status);
}
export function openDirectNotificationBatterySettings(): void {
  native?.openBatteryOptimizationSettings?.();
}

export function makeDirectNotificationConnection(connection: SavedRemoteConnection) {
  if (
    connection.authenticationMethod === "dpop" ||
    connection.relayManaged ||
    !connection.bearerToken
  )
    return null;
  let url: URL;
  try {
    url = new URL(connection.wsBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  if (url.username || url.password) return null;
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  url.searchParams.set(ORCHESTRATION_PROTOCOL_QUERY_PARAM, String(ORCHESTRATION_PROTOCOL_VERSION));
  // Native WebSockets can send headers: pairing credentials never go in a URL.
  return {
    environmentId: connection.environmentId,
    url: url.toString(),
    token: connection.bearerToken,
  };
}

const preparedDirectRoutes = new Map<
  string,
  NonNullable<ReturnType<typeof makeDirectNotificationConnection>>
>();

/** Native service owns delivery; this coordinator only refreshes paired routes while visible. */
export function DirectNotificationsCoordinator() {
  const enabled = useDirectNotificationsEnabled();
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const environments = useWorkspaceEnvironments();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the Android notification listener in step with the connected environments.
  useEffect(() => {
    if (!supportsDirectNotifications()) return;
    const update = () => {
      if (AppState.currentState !== "active" || isLoadingSavedConnection) return;
      refreshEnabled();
      if (!enabled) {
        preparedDirectRoutes.clear();
        native?.updateDirectNotificationConnections("[]", "t3code");
        return;
      }
      const activeIds = new Set(
        environments
          .filter((environment) => environment.isEnabled && !environment.isRelayManaged)
          .map((environment) => environment.environmentId),
      );
      for (const id of preparedDirectRoutes.keys()) {
        if (!activeIds.has(id as SavedRemoteConnection["environmentId"]))
          preparedDirectRoutes.delete(id);
      }
      for (const connection of Object.values(savedConnectionsById)) {
        if (!activeIds.has(connection.environmentId)) continue;
        const direct = makeDirectNotificationConnection(connection);
        if (direct) preparedDirectRoutes.set(connection.environmentId, direct);
      }
      const scheme = Constants.expoConfig?.scheme;
      native?.updateDirectNotificationConnections(
        JSON.stringify([...preparedDirectRoutes.values()]),
        (Array.isArray(scheme) ? scheme[0] : scheme) ?? "t3code",
      );
    };
    update();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") update();
    });
    return () => subscription.remove();
  }, [enabled, environments, savedConnectionsById, isLoadingSavedConnection]);
  return null;
}
