import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { DeviceCommandRun } from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({
  width: 400,
  runs: [] as DeviceCommandRun[],
  alert: vi.fn(),
  run: vi.fn(),
  save: vi.fn(),
  dispatch: vi.fn(),
  goBack: vi.fn(),
  prevent: false,
  onRemove: (_event: { data: { action: { type: string } } }) => {},
}));
const Children = vi.hoisted(
  () =>
    ({ children }: { children?: ReactNode }) =>
      children,
);
vi.mock("react-native", () => ({
  View: ({ children, style }: { children?: ReactNode; style?: object }) => (
    <div style={style}>{children}</div>
  ),
  ScrollView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TextInput: ({
    value,
    accessibilityLabel,
    onChangeText,
  }: {
    value: string;
    accessibilityLabel: string;
    onChangeText: (text: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  Modal: ({
    children,
    visible,
    onRequestClose,
  }: {
    children?: ReactNode;
    visible: boolean;
    onRequestClose: () => void;
  }) =>
    visible ? (
      <section role="dialog">
        <button onClick={onRequestClose}>Hardware back</button>
        {children}
      </section>
    ) : null,
  Alert: { alert: mocks.alert },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Linking: { openSettings() {} },
  useWindowDimensions: () => ({ width: mocks.width, fontScale: 1 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: Children,
  SafeAreaView: Children,
  useSafeAreaInsets: () => ({ left: 0, right: 0, bottom: 24 }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ canGoBack: () => true, goBack: mocks.goBack, dispatch: mocks.dispatch }),
  StackActions: { replace: (name: string) => ({ type: "REPLACE", name }) },
  usePreventRemove: (enabled: boolean, callback: typeof mocks.onRemove) => {
    mocks.prevent = enabled;
    mocks.onRemove = callback;
  },
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: ({
    onClose,
    actions,
  }: {
    onClose: () => void;
    actions: { accessibilityLabel: string; onPress: () => void; disabled?: boolean }[];
  }) => (
    <header>
      <button onClick={onClose}>Close utilities</button>
      {actions.map((action) => (
        <button key={action.accessibilityLabel} disabled={action.disabled} onClick={action.onPress}>
          {action.accessibilityLabel}
        </button>
      ))}
    </header>
  ),
}));
vi.mock("../../components/ui/SheetHeader", () => ({
  SheetHeader: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close output</button>
  ),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/ThemedSwitch", () => ({ ThemedSwitch: () => null }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("../device-utilities/utilitiesStore", () => ({
  utilitiesAvailable: true,
  useDeviceUtilities: () => ({ snapshot: null, error: null, now: 0, statuses: [] }),
  refreshUtilities: vi.fn(),
  importUtilities: vi.fn(),
  runUtilityAction: vi.fn(),
}));
vi.mock("./termuxCommands", () => ({
  termuxCommandsAvailable: true,
  readTermuxCommands: () => ({
    installed: true,
    permissionGranted: true,
    commands: [
      {
        id: "up",
        name: "Start",
        command: "start-local",
        icon: "terminal",
        confirm: true,
        showInCommandPalette: false,
      },
    ],
    runs: mocks.runs,
  }),
  runTermuxCommand: mocks.run,
  saveTermuxCommands: mocks.save,
  requestTermuxPermission: vi.fn(),
  clearTermuxWaitingStatus: vi.fn(),
  testTermuxConnection: vi.fn(),
}));
import { DeviceCommandsScreen } from "./DeviceCommandsScreen";
let root: Root;
let container: HTMLDivElement;
function render() {
  act(() => root.render(<DeviceCommandsScreen />));
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => button.click());
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.width = 400;
  mocks.runs = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

it("keeps command editing mounted across compact/wide layout changes and guards route removal", () => {
  render();
  click("Edit commands");
  click("Add command");
  expect(container.querySelectorAll("input")).toHaveLength(4);
  expect(mocks.prevent).toBe(true);
  mocks.width = 1200;
  render();
  expect(container.querySelectorAll("input")).toHaveLength(4);
  act(() => mocks.onRemove({ data: { action: { type: "GO_BACK" } } }));
  expect(mocks.dispatch).not.toHaveBeenCalled();
  const buttons = mocks.alert.mock.calls.at(-1)![2];
  act(() => buttons.find((button: { text: string }) => button.text === "Discard").onPress());
  expect(mocks.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  mocks.width = 400;
  render();
  expect(container.querySelectorAll("input")).toHaveLength(4);
  click("Discard changes");
  expect(mocks.prevent).toBe(false);
});

it("confirms local execution, retains the output dialog during rotation, and reloads native results after reopening", () => {
  render();
  click("Run");
  expect(mocks.run).not.toHaveBeenCalled();
  mocks.runs = [
    {
      runId: "one",
      commandId: "up",
      commandName: "Start",
      status: "running",
      startedAt: 1,
      finishedAt: null,
      exitCode: null,
      output: "",
      outputTruncated: false,
      error: null,
    },
  ];
  act(() =>
    mocks.alert.mock.calls
      .at(-1)![2]
      .find((button: { text: string }) => button.text === "Run")
      .onPress(),
  );
  expect(mocks.run).toHaveBeenCalledWith("up");
  const command = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("StartRunning"),
  )!;
  act(() => command.click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  mocks.width = 1200;
  render();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  mocks.runs = [
    { ...mocks.runs[0]!, status: "succeeded", finishedAt: 2, exitCode: 0, output: "local result" },
  ];
  act(() => vi.advanceTimersByTime(1500));
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("local result");
  click("Hardware back");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.goBack).not.toHaveBeenCalled();
  click("Close utilities");
  expect(mocks.goBack).toHaveBeenCalledOnce();
  act(() => root.unmount());
  root = createRoot(container);
  render();
  expect(container.textContent).toContain("Finished");
  expect(mocks.run).toHaveBeenCalledOnce();
});

it.each([
  { width: 400, direction: "column" },
  { width: 1200, direction: "row" },
])("keeps the Commands heading with its controls at $width points", ({ width, direction }) => {
  mocks.width = width;
  render();
  const headings = [...container.querySelectorAll("span")];
  const commands = headings.filter((element) => element.textContent === "Commands");
  expect(commands).toHaveLength(1);
  const commandColumn = commands[0]!.parentElement!;
  expect(commandColumn.firstElementChild).toBe(commands[0]);
  expect(commandColumn.textContent).toContain("Termux setup");
  expect(
    [...commandColumn.querySelectorAll("button")].some((button) => button.textContent === "Run"),
  ).toBe(true);
  expect(commandColumn.textContent).not.toContain("Services");
  const layout = commandColumn.parentElement!;
  expect(layout.style.flexDirection).toBe(direction);
  expect(layout.children).toHaveLength(2);
  expect(layout.children[0]!.textContent).toContain("Services");
  expect(layout.children[0]!.textContent).not.toContain("Commands");
  expect(layout.children[1]).toBe(commandColumn);
});
