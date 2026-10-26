import type { ReactNode } from "react";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { ThreadListToolbar } from "./ThreadListToolbar";

const harness = vi.hoisted(() => ({
  threads: [] as unknown[],
  settings: {} as Record<string, unknown>,
  update: vi.fn(),
  canWrite: true,
  listeners: new Set<() => void>(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) =>
    useSyncExternalStore(subscribe, () =>
      atom === "threads" ? harness.threads : harness.settings,
    ),
}));
vi.mock("../../state/threads", () => ({
  environmentThreadShells: { threadShellsAtom: "threads" },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { settingsValueAtom: () => "settings", updateSettings: "update" },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.update }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => useSyncExternalStore(subscribe, () => harness.canWrite),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnection: () => ({ environmentLabel: "GWDG HPC" }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    accessibilityRole: string;
    accessibilityLabel: string;
    accessibilityState: { checked?: boolean };
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button
      role={accessibilityRole}
      aria-label={accessibilityLabel}
      aria-checked={accessibilityState.checked}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({}),
  useNavigationState: () => true,
}));
vi.mock("../workspace/WorkspaceTabsContext", () => ({ useWorkspaceTabs: () => null }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceConnectionState: () => ({ hasConnections: false }),
}));
vi.mock("../../components/ui/useToolbarLayout", () => ({
  useToolbarLayout: () => ({ paddingTop: 0, paddingBottom: 0 }),
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({ useHardwareKeyboardCommand: () => {} }));
vi.mock("../../components/ui/AndroidScreenHeader", () => ({ AndroidHeaderIconButton: () => null }));
vi.mock("../../components/ui/AndroidAnchoredMenu", () => ({ AndroidAnchoredMenu: () => null }));
vi.mock("../../components/ui/SearchField", () => ({ SearchField: () => null }));
vi.mock("../workspace/WorkspaceListToolbarRow", () => ({ WorkspaceListToolbarRow: () => null }));
vi.mock("./ConversationListToolbarButtons", () => ({ ConversationListToolbarButtons: () => null }));

function subscribe(listener: () => void) {
  harness.listeners.add(listener);
  return () => {
    harness.listeners.delete(listener);
  };
}

function setup() {
  harness.update.mockReset();
  harness.settings = { cacheWarmingSessions: {} };
  harness.canWrite = true;
  const environmentId = EnvironmentId.make("server-1");
  const hotId = ThreadId.make("hot");
  harness.threads = [
    {
      id: hotId,
      environmentId,
      archivedAt: null,
      cacheHud: {
        driver: "codex",
        ttlMs: 3600000,
        usage: { updatedAt: "2026-10-23T10:00:00Z", cachedInputTokens: 100 },
      },
    },
    { id: ThreadId.make("cold"), environmentId, archivedAt: null, cacheHud: null },
  ];
  const host = document.createElement("div");
  const root = createRoot(host);
  const reactGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  const render = () =>
    act(() => {
      for (const listener of harness.listeners) listener();
      root.render(
        <ThreadListToolbar
          sidebar
          searchQuery=""
          onSearchQueryChange={() => {}}
          filterActions={[]}
          filterCustomized={false}
          onFilterAction={() => {}}
          onOpenEnvironments={() => {}}
          cacheWarmingEnvironmentId={environmentId}
        />,
      );
    });
  return {
    host,
    render,
    environmentId,
    hotId,
    [Symbol.dispose]() {
      act(() => root.unmount());
      reactGlobals.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

it("shows the Android sidebar's warm-all switch and updates only hot conversations", () => {
  using _clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-23T10:05:00Z"));
  using screen = setup();
  screen.render();
  const toggle = screen.host.querySelector<HTMLButtonElement>('[role="switch"]');
  expect(toggle).not.toBeNull();
  expect(toggle?.disabled).toBe(false);
  expect(screen.host.textContent).toContain("GWDG HPC · Codex/Claude · billable turns");
  expect(toggle?.getAttribute("aria-label")).toBe(
    "Enable warming for all hot conversations on GWDG HPC",
  );
  act(() => toggle?.click());
  expect(harness.update).toHaveBeenCalledExactlyOnceWith({
    environmentId: screen.environmentId,
    input: { patch: { cacheWarmingSessions: { [screen.hotId]: true } } },
  });
  harness.settings = { cacheWarmingSessions: { [screen.hotId]: true } };
  screen.render();
  expect(screen.host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  harness.canWrite = false;
  screen.render();
  expect(screen.host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
});
