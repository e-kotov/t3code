import { T, useGT } from "gt-react-native";
import { UtilitiesSection } from "../device-utilities/UtilitiesSection";
import { StackActions, useNavigation, usePreventRemove } from "@react-navigation/native";
import { WindowHingeContext } from "../../native/window-hinge-context";
import { utilitiesLayout } from "./utilitiesLayout";
import {
  DEVICE_COMMAND_ICONS,
  DEVICE_COMMANDS_MAX_COUNT,
  type DeviceCommand,
  type DeviceCommandRun,
} from "@t3tools/contracts";
import { use, useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppBar } from "../../components/ui/AppBar";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { Button } from "../../components/ui/Button";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import {
  createDeviceCommand,
  latestDeviceCommandRuns,
  reorderDeviceCommand,
  sameDeviceCommands,
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

export function DeviceCommandsScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const hinge = use(WindowHingeContext);
  const { width, fontScale } = useWindowDimensions();
  const { left, right, wide } = utilitiesLayout(width, fontScale, insets, hinge);
  const bottomPadding = Math.max(40, insets.bottom + 16);
  const close = () =>
    navigation.canGoBack()
      ? navigation.goBack()
      : navigation.dispatch(StackActions.replace("Home"));
  const [{ state, error }, setSnapshot] = useState(readSnapshot);
  function setError(error: string | null) {
    setSnapshot((previous) => ({ ...previous, error }));
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReadonlyArray<DeviceCommand> | null>(null);
  const [editBaseline, setEditBaseline] = useState<ReadonlyArray<DeviceCommand>>([]);
  const dirty = editing && draft !== null && !sameDeviceCommands(draft, editBaseline);
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert(gt("Discard command changes?"), gt("Your unsaved command edits will be lost."), [
      { text: gt("Keep editing"), style: "cancel" },
      {
        text: gt("Discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
  const [outputId, setOutputId] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const refresh = useCallback(() => setSnapshot(readSnapshot()), []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh commands on app active state
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) => {
      setActive(value === "active");
      if (value === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  const running = state?.runs.some((run) => run.status === "running") ?? false;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- poll running commands while active
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
      Alert.alert(gt("Run {name}?", { name: command.name }), command.command, [
        { text: gt("Cancel"), style: "cancel" },
        { text: gt("Run"), onPress: execute },
      ]);
    else execute();
  }
  function update(id: string, patch: Partial<DeviceCommand>) {
    setDraft(items.map((command) => (command.id === id ? { ...command, ...patch } : command)));
  }
  function edit() {
    if (!editing) {
      setEditBaseline(state?.commands ?? []);
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
    if (!run) return gt("Ready");
    if (run.status === "running") return gt("Running · waiting for Termux result");
    if (run.status === "succeeded") return gt("Finished");
    return (
      run.error ??
      (run.exitCode === null ? gt("Failed") : gt("Failed · exit {code}", { code: run.exitCode }))
    );
  }
  return (
    <View className="flex-1 bg-screen" style={{ paddingLeft: left, paddingRight: right }}>
      <AppBar
        onClose={close}
        closeAccessibilityLabel={gt("Close utilities")}
        title={gt("Utilities")}
        actions={
          state
            ? [
                {
                  icon: editing ? "checkmark" : "pencil",
                  accessibilityLabel: editing ? gt("Save commands") : gt("Edit commands"),
                  onPress: edit,
                  disabled:
                    editing && items.some((item) => !item.name.trim() || !item.command.trim()),
                } as const,
              ]
            : []
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: bottomPadding,
          width: "100%",
          maxWidth: 1200,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: wide ? "row" : "column", gap: 24 }}>
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
            <UtilitiesSection />
          </View>
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: 16 }}>
            <Text className="font-t3-medium">
              <T>Commands</T>
            </Text>
            <Text className="text-foreground-muted">
              <T>
                Commands run locally in Termux, using this phone’s setup. Output arrives when the
                command finishes.
              </T>
            </Text>
            {!termuxCommandsAvailable ? (
              <Text>
                <T>Install an updated Android build to use Termux commands.</T>
              </Text>
            ) : null}
            {state ? (
              <View className="gap-3 rounded-xl border border-border p-4">
                <Text className="font-t3-medium">
                  <T>Termux setup</T>
                </Text>
                <Text>
                  {state.installed ? gt("Termux installed") : gt("Install Termux first")} ·{" "}
                  {state.permissionGranted ? gt("Permission granted") : gt("Permission needed")}
                </Text>
                <Text className="text-foreground-muted">
                  <T>
                    Enable allow-external-apps = true in ~/.termux/termux.properties. Test the
                    connection to verify it.
                  </T>
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {!state.permissionGranted && state.installed ? (
                    <Button
                      label={gt("Grant permission")}
                      onPress={() =>
                        void requestTermuxPermission()
                          .then(refresh)
                          .catch((cause) => setError(errorText(cause)))
                      }
                    />
                  ) : null}
                  <Button
                    label={gt("Android settings")}
                    onPress={() => void Linking.openSettings()}
                  />
                  <Button
                    label={probe?.status === "running" ? gt("Testing…") : gt("Test connection")}
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
              <Text>
                <T>No commands yet. Tap Edit to add your first command.</T>
              </Text>
            ) : null}
            {items.map((command, index) => (
              <View key={command.id} className="gap-3 rounded-xl border border-border p-4">
                {editing ? (
                  <>
                    <Text>
                      <T>Name</T>
                    </Text>
                    <TextInput
                      accessibilityLabel={gt("Command name")}
                      value={command.name}
                      onChangeText={(name) => update(command.id, { name })}
                      className="rounded-lg border border-border p-3 text-foreground"
                    />
                    <Text>
                      <T>Shell command</T>
                    </Text>
                    <TextInput
                      accessibilityLabel={gt("Shell command")}
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
                            command.icon === icon
                              ? "rounded-lg bg-subtle-strong p-3"
                              : "rounded-lg p-3"
                          }
                        >
                          <SymbolView
                            name={icons[icon]}
                            size={24}
                            tintColorClassName="accent-icon"
                          />
                        </Pressable>
                      ))}
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text>
                        <T>Ask before running</T>
                      </Text>
                      <ThemedSwitch
                        accessibilityLabel={gt("Ask before running")}
                        value={command.confirm}
                        onValueChange={(confirm) => update(command.id, { confirm })}
                      />
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        label={gt("Move up")}
                        disabled={index === 0}
                        onPress={() => setDraft(reorderDeviceCommand(items, index, index - 1))}
                      />
                      <Button
                        label={gt("Move down")}
                        disabled={index === items.length - 1}
                        onPress={() => setDraft(reorderDeviceCommand(items, index, index + 1))}
                      />
                      <Button
                        label={gt("Delete", { $context: "verb, deletes a command" })}
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
                        <Text className="text-foreground-muted">
                          {resultLabel(runs[command.id])}
                        </Text>
                      </View>
                    </Pressable>
                    <Button
                      label={
                        runs[command.id]?.status === "running"
                          ? gt("Running…")
                          : gt("Run", { $context: "verb, executes a shell command" })
                      }
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
                  label={gt("Add command")}
                  disabled={items.length >= DEVICE_COMMANDS_MAX_COUNT}
                  onPress={() => setDraft([...items, createDeviceCommand(items)])}
                />
                <Button
                  label={gt("Discard changes")}
                  onPress={() => {
                    setDraft(null);
                    setEditing(false);
                  }}
                />
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <Modal visible={!!output} onRequestClose={() => setOutputId(null)} animationType="slide">
        <SafeAreaProvider style={{ flex: 1 }}>
          <View className="flex-1 bg-screen">
            <SafeAreaView
              style={{ flex: 1, paddingLeft: left, paddingRight: right }}
              edges={["top", "bottom"]}
            >
              <SheetHeader
                presentation="inline"
                title={output?.commandName ?? gt("Output")}
                onClose={() => setOutputId(null)}
                accessibilityLabel={gt("Close output")}
              />
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                <Text>{resultLabel(output)}</Text>
                {output?.outputTruncated ? (
                  <Text>
                    <T>Showing the latest output only.</T>
                  </Text>
                ) : null}
                <Text selectable>
                  {output?.output ||
                    (output?.status === "running"
                      ? gt(
                          "Termux returns output when the command finishes. Closing T3 does not stop it.",
                        )
                      : gt("No output."))}
                </Text>
                {output?.status === "running" ? (
                  <Button
                    label={gt("Clear waiting status")}
                    onPress={() =>
                      Alert.alert(
                        gt("Clear waiting status?"),
                        gt(
                          "This does not stop the Termux command. Confirm it has stopped before running it again.",
                        ),
                        [
                          { text: gt("Cancel"), style: "cancel" },
                          {
                            text: gt("Clear status"),
                            onPress: () => perform(() => clearTermuxWaitingStatus(output.runId)),
                          },
                        ],
                      )
                    }
                  />
                ) : null}
              </ScrollView>
            </SafeAreaView>
          </View>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}
