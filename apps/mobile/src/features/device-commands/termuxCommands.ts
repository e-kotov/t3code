import { requireOptionalNativeModule } from "expo";
import type { DeviceCommand } from "@t3tools/contracts";
import { Linking, PermissionsAndroid, Platform } from "react-native";
import { decodeTermuxState } from "./termuxCommands.logic";

interface TermuxNative {
  getState(): string;
  save(document: string): void;
  run(commandId: string): string;
  testConnection(): string;
  clearWaiting(runId: string): void;
}
const native = Platform.OS === "android" ? requireOptionalNativeModule<TermuxNative>("T3TermuxCommand") : null;
export const termuxCommandsAvailable = native !== null;

function requireTermux() {
  if (!native) throw new Error("This build does not include Termux commands. Install an updated Android build.");
  return native;
}

export function readTermuxCommands() {
  return decodeTermuxState(JSON.parse(requireTermux().getState()));
}
export function saveTermuxCommands(commands: ReadonlyArray<DeviceCommand>) {
  requireTermux().save(JSON.stringify({ commands }));
}
export function runTermuxCommand(commandId: string) { requireTermux().run(commandId); }
export function testTermuxConnection() { requireTermux().testConnection(); }
export function clearTermuxWaitingStatus(runId: string) { requireTermux().clearWaiting(runId); }

export async function requestTermuxPermission() {
  const permission = "com.termux.permission.RUN_COMMAND" as Parameters<typeof PermissionsAndroid.request>[0];
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) await Linking.openSettings();
}
