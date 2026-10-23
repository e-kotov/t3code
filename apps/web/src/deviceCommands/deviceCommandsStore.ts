import { applyRunUpdate, type RunsByCommandId } from "./deviceCommands.logic";
export { newDeviceCommandId, moveDeviceCommand } from "./deviceCommands.logic";
import type { DeviceCommand, DeviceCommandRun, DeviceCommandsBridge } from "@t3tools/contracts";
import { create } from "zustand";

import { ensureLocalApi } from "../localApi";
import { toastManager } from "../components/ui/toast";

/** Present only in the desktop app; the web build has no local shell to run in. */
export function getDeviceCommandsBridge(): DeviceCommandsBridge | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.deviceCommands ?? null;
}

interface DeviceCommandsStoreState {
  readonly loaded: boolean;
  readonly commands: ReadonlyArray<DeviceCommand>;
  readonly storagePath: string | null;
  readonly loadError: string | null;
  readonly runsByCommandId: RunsByCommandId;
  /** Run whose output dialog is open. */
  readonly outputRunId: string | null;
}

export const useDeviceCommandsStore = create<DeviceCommandsStoreState>(() => ({
  loaded: false,
  commands: [],
  storagePath: null,
  loadError: null,
  runsByCommandId: {},
  outputRunId: null,
}));

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Runs started from this window, so only their completion raises a toast. */
const startedHere = new Set<string>();
let subscribed = false;

function onRunUpdate(run: DeviceCommandRun): void {
  useDeviceCommandsStore.setState((state) => ({
    runsByCommandId: applyRunUpdate(state.runsByCommandId, run),
  }));
  if (run.status === "running" || !startedHere.delete(run.runId)) return;
  const toastId = toastManager.add({
    type: run.status === "succeeded" ? "success" : run.status === "stopped" ? "info" : "error",
    title:
      run.status === "succeeded"
        ? `${run.commandName} finished`
        : run.status === "stopped"
          ? `${run.commandName} stopped`
          : `${run.commandName} failed`,
    description:
      run.error ?? (run.exitCode !== null && run.exitCode !== 0 ? `Exit code ${run.exitCode}` : ""),
    actionProps: {
      children: "Show output",
      onClick: () => {
        toastManager.close(toastId);
        openDeviceCommandOutput(run.runId);
      },
    },
  });
}

/** Loads the list and subscribes to run updates once per window. */
export function ensureDeviceCommandsLoaded(): void {
  const bridge = getDeviceCommandsBridge();
  if (!bridge || subscribed) return;
  subscribed = true;
  bridge.onRun(onRunUpdate);
  void reloadDeviceCommands();
  void bridge
    .listRuns()
    .then((runs) =>
      useDeviceCommandsStore.setState((state) => ({
        runsByCommandId: runs.reduce(applyRunUpdate, state.runsByCommandId),
      })),
    )
    .catch(() => undefined);
}

export async function reloadDeviceCommands(): Promise<void> {
  const bridge = getDeviceCommandsBridge();
  if (!bridge) return;
  try {
    const state = await bridge.getState();
    useDeviceCommandsStore.setState({
      loaded: true,
      commands: state.commands,
      storagePath: state.storagePath,
      loadError: null,
    });
  } catch (cause) {
    useDeviceCommandsStore.setState({ loaded: true, loadError: errorText(cause) });
  }
}

/** Saves the whole list; throws so the editor can keep the user's input on failure. */
export async function saveDeviceCommands(commands: ReadonlyArray<DeviceCommand>): Promise<void> {
  const bridge = getDeviceCommandsBridge();
  if (!bridge) throw new Error("Commands run only in the desktop app.");
  const state = await bridge.save({ commands });
  useDeviceCommandsStore.setState({
    commands: state.commands,
    storagePath: state.storagePath,
    loadError: null,
  });
}

export async function runDeviceCommand(command: DeviceCommand): Promise<void> {
  const bridge = getDeviceCommandsBridge();
  if (!bridge) return;
  if (command.confirm) {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Run "${command.name}"?\n${command.command}`,
    );
    if (!confirmed) return;
  }
  try {
    const run = await bridge.run(command.id);
    startedHere.add(run.runId);
    const received = useDeviceCommandsStore.getState().runsByCommandId[command.id];
    // A quick command can finish before its IPC start reply reaches the window.
    onRunUpdate(received?.runId === run.runId && received.status !== "running" ? received : run);
    openDeviceCommandOutput(run.runId);
  } catch (cause) {
    toastManager.add({
      type: "error",
      title: `Could not run ${command.name}`,
      description: errorText(cause),
    });
  }
}

export async function stopDeviceCommandRun(runId: string): Promise<void> {
  await getDeviceCommandsBridge()?.stop(runId);
}

function openDeviceCommandOutput(runId: string): void {
  useDeviceCommandsStore.setState({ outputRunId: runId });
}

export function closeDeviceCommandOutput(): void {
  useDeviceCommandsStore.setState({ outputRunId: null });
}
