import { UtilitiesSection } from "../device-utilities/UtilitiesSection";
import { WorkspaceTabsContext, useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { useUtilitiesSidebarExitActions } from "./useUtilitiesSidebarActions";
import {
  DEVICE_COMMAND_ICONS,
  DEVICE_COMMANDS_MAX_COUNT,
  type DeviceCommand,
  type DeviceCommandRun,
} from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { Button } from "../../components/ui/Button";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import {
  createDeviceCommand,
  latestDeviceCommandRuns,
  reorderDeviceCommand,
} from "./termuxCommands.logic";
import {
  clearTermuxWaitingStatus,
  readTermuxCommands,
  requestTermuxPermission,
  runTermuxCommand,
  saveTermuxCommands,
  termuxCommandsAvailable,
  testTermuxConnection,
} from "./termuxCommands";

const icons: Record<DeviceCommand["icon"], AppSymbolName> = {
  terminal: "terminal",
  play: "play",
  stop: "stop.fill",
  server: "server.rack",
  refresh: "arrow.clockwise",
  power: "bolt.circle",
  plug: "cable.connector",
  wrench: "hammer",
};
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function readSnapshot(): {
  state: ReturnType<typeof readTermuxCommands> | null;
  error: string | null;
} {
  try {
    return { state: readTermuxCommands(), error: null };
  } catch (cause) {
    return { state: null, error: errorText(cause) };
  }
}

export function DeviceCommandsScreen(props: { readonly sidebar?: boolean }) {
  const exitActions = useUtilitiesSidebarExitActions();
  const workspaceTabs = useWorkspaceTabs();
  const bottomPadding = Math.max(40, (workspaceTabs?.bottomClearance ?? 0) + 16);
  const [{ state, error }, setSnapshot] = useState(readSnapshot);
  function setError(error: string | null) {
    setSnapshot((previous) => ({ ...previous, error }));
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReadonlyArray<DeviceCommand> | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const refresh = useCallback(() => setSnapshot(readSnapshot()), []);
  // oxlint-disable-next-line t3code/react-effect-budget -- refresh commands on app active state
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) => {
      setActive(value === "active");
      if (value === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  const running = state?.runs.some((run) => run.status === "running") ?? false;
  // oxlint-disable-next-line t3code/react-effect-budget -- poll running commands while active
  useEffect(() => {
    if (!running || !active) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [running, active, refresh]);
  const items = draft ?? state?.commands ?? [];
  const runs = latestDeviceCommandRuns(state?.runs ?? []);
  const output = state?.runs.find((run) => run.runId === outputId);
  const probe = runs.__termux_setup_probe__;

  function perform(action: () => void) {
    try {
      action();
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  function run(command: DeviceCommand) {
    const execute = () => perform(() => runTermuxCommand(command.id));
    if (command.confirm)
      Alert.alert(`Run ${command.name}?`, command.command, [
        { text: "Cancel", style: "cancel" },
        { text: "Run", onPress: execute },
      ]);
    else execute();
  }
  function update(id: string, patch: Partial<DeviceCommand>) {
    setDraft(items.map((command) => (command.id === id ? { ...command, ...patch } : command)));
  }
  function edit() {
    if (!editing) {
      setDraft(state?.commands ?? []);
      setEditing(true);
      return;
    }
    try {
      saveTermuxCommands(items);
      setDraft(null);
      setEditing(false);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  function resultLabel(run: DeviceCommandRun | undefined) {
    if (!run) return "Ready";
    if (run.status === "running") return "Running · waiting for Termux result";
    if (run.status === "succeeded") return "Finished";
    return run.error ?? `Failed${run.exitCode === null ? "" : ` · exit ${run.exitCode}`}`;
  }
  return (
    <View className="flex-1 bg-screen">
      <AndroidScreenHeader
        title="Utilities"
        actions={[
          ...(props.sidebar ? exitActions : []),
          ...(state
            ? [
                {
                  icon: editing ? "checkmark" : "pencil",
                  accessibilityLabel: editing ? "Save commands" : "Edit commands",
                  onPress: edit,
                  disabled:
                    editing && items.some((item) => !item.name.trim() || !item.command.trim()),
                } as const,
              ]
            : []),
        ]}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <UtilitiesSection />
        <Text className="text-foreground-muted">
          Commands run locally in Termux, using this phone’s setup. Output arrives when the command
          finishes.
        </Text>
        {!termuxCommandsAvailable ? (
          <Text>Install an updated Android build to use Termux commands.</Text>
        ) : null}
        {state ? (
          <View className="gap-3 rounded-xl border border-border p-4">
            <Text className="font-t3-medium">Termux setup</Text>
            <Text>
              {state.installed ? "Termux installed" : "Install Termux first"} ·{" "}
              {state.permissionGranted ? "Permission granted" : "Permission needed"}
            </Text>
            <Text className="text-foreground-muted">
              Enable allow-external-apps = true in ~/.termux/termux.properties. Test the connection
              to verify it.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {!state.permissionGranted && state.installed ? (
                <Button
                  label="Grant permission"
                  onPress={() =>
                    void requestTermuxPermission()
                      .then(refresh)
                      .catch((cause) => setError(errorText(cause)))
                  }
                />
              ) : null}
              <Button label="Android settings" onPress={() => void Linking.openSettings()} />
              <Button
                label={probe?.status === "running" ? "Testing…" : "Test connection"}
                disabled={
                  !state.installed || !state.permissionGranted || probe?.status === "running"
                }
                onPress={() => perform(testTermuxConnection)}
              />
            </View>
            {probe ? <Text>{resultLabel(probe)}</Text> : null}
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {items.length === 0 ? (
          <Text>No commands yet. Tap Edit to add your first command.</Text>
        ) : null}
        {items.map((command, index) => (
          <View key={command.id} className="gap-3 rounded-xl border border-border p-4">
            {editing ? (
              <>
                <Text>Name</Text>
                <TextInput
                  accessibilityLabel="Command name"
                  value={command.name}
                  onChangeText={(name) => update(command.id, { name })}
                  className="rounded-lg border border-border p-3 text-foreground"
                />
                <Text>Shell command</Text>
                <TextInput
                  accessibilityLabel="Shell command"
                  value={command.command}
                  onChangeText={(value) => update(command.id, { command: value })}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-24 rounded-lg border border-border p-3 text-foreground"
                />
                <View className="flex-row flex-wrap gap-2">
                  {DEVICE_COMMAND_ICONS.map((icon) => (
                    <Pressable
                      key={icon}
                      accessibilityRole="button"
                      accessibilityLabel={icon}
                      accessibilityState={{ selected: command.icon === icon }}
                      onPress={() => update(command.id, { icon })}
                      className={
                        command.icon === icon ? "rounded-lg bg-subtle-strong p-3" : "rounded-lg p-3"
                      }
                    >
                      <SymbolView name={icons[icon]} size={24} tintColorClassName="accent-icon" />
                    </Pressable>
                  ))}
                </View>
                <View className="flex-row items-center justify-between">
                  <Text>Ask before running</Text>
                  <ThemedSwitch
                    accessibilityLabel="Ask before running"
                    value={command.confirm}
                    onValueChange={(confirm) => update(command.id, { confirm })}
                  />
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Move up"
                    disabled={index === 0}
                    onPress={() => setDraft(reorderDeviceCommand(items, index, index - 1))}
                  />
                  <Button
                    label="Move down"
                    disabled={index === items.length - 1}
                    onPress={() => setDraft(reorderDeviceCommand(items, index, index + 1))}
                  />
                  <Button
                    label="Delete"
                    tone="danger"
                    onPress={() => setDraft(items.filter((item) => item.id !== command.id))}
                  />
                </View>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    runs[command.id] ? setOutputId(runs[command.id]!.runId) : run(command)
                  }
                  className="flex-row items-center gap-3 py-2"
                >
                  <SymbolView
                    name={icons[command.icon]}
                    size={24}
                    tintColorClassName="accent-icon"
                  />
                  <View className="flex-1">
                    <Text className="font-t3-medium">{command.name}</Text>
                    <Text className="text-foreground-muted">{resultLabel(runs[command.id])}</Text>
                  </View>
                </Pressable>
                <Button
                  label={runs[command.id]?.status === "running" ? "Running…" : "Run"}
                  disabled={
                    !state?.installed ||
                    !state.permissionGranted ||
                    runs[command.id]?.status === "running"
                  }
                  onPress={() => run(command)}
                />
              </>
            )}
          </View>
        ))}
        {editing ? (
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Add command"
              disabled={items.length >= DEVICE_COMMANDS_MAX_COUNT}
              onPress={() => setDraft([...items, createDeviceCommand(items)])}
            />
            <Button
              label="Discard changes"
              onPress={() => {
                setDraft(null);
                setEditing(false);
              }}
            />
          </View>
        ) : null}
      </ScrollView>
      <Modal visible={!!output} onRequestClose={() => setOutputId(null)} animationType="slide">
        <View className="flex-1 bg-screen">
          <AndroidScreenHeader
            title={output?.commandName ?? "Output"}
            onBack={() => setOutputId(null)}
          />
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text>{resultLabel(output)}</Text>
            {output?.outputTruncated ? <Text>Showing the latest output only.</Text> : null}
            <Text selectable>
              {output?.output ||
                (output?.status === "running"
                  ? "Termux returns output when the command finishes. Closing T3 does not stop it."
                  : "No output.")}
            </Text>
            {output?.status === "running" ? (
              <Button
                label="Clear waiting status"
                onPress={() =>
                  Alert.alert(
                    "Clear waiting status?",
                    "This does not stop the Termux command. Confirm it has stopped before running it again.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear status",
                        onPress: () => perform(() => clearTermuxWaitingStatus(output.runId)),
                      },
                    ],
                  )
                }
              />
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export function UtilitiesSidebar(props: { readonly context: ReturnType<typeof useWorkspaceTabs> }) {
  return (
    <WorkspaceTabsContext value={props.context}>
      <DeviceCommandsScreen sidebar />
    </WorkspaceTabsContext>
  );
}
