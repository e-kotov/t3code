import type { ReactNode } from "react";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader.android";
import {
  isConversationListCustomized,
  type ConversationListControls,
} from "./conversationListOptions";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

const harness = vi.hoisted(() => ({
  threads: [] as unknown[],
  settings: {} as Record<string, unknown>,
  update: vi.fn(),
  canWrite: true,
  listeners: new Set<() => void>(),
  lastAppBarProps: null as any,
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
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { dismiss: () => {}, isVisible: () => false },
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
vi.mock("../layout/workspace/WorkspaceTabsContext", () => ({ useWorkspaceTabs: () => null }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceConnectionState: () => ({ hasConnections: true }),
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({ useHardwareKeyboardCommand: () => {} }));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: (props: any) => {
    harness.lastAppBarProps = props;
    return null;
  },
}));
vi.mock("../layout/workspace/WorkspaceBrandTitle", () => ({ WorkspaceBrandTitle: () => null }));

function subscribe(listener: () => void) {
  harness.listeners.add(listener);
  return () => {
    harness.listeners.delete(listener);
  };
}

function setup(props?: {
  conversationList?: ConversationListControls;
  onEnvironmentChange?: (id: EnvironmentId | null) => void;
}) {
  harness.update.mockReset();
  harness.lastAppBarProps = null;
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
        <WorkspaceListHeader
          accessibilityLabel="T3 Code, Threads"
          onOpenEnvironments={() => {}}
          cacheWarmingEnvironmentId={environmentId}
          search={{
            value: "",
            onChangeText: () => {},
            placeholder: "Search",
            accessibilityLabel: "Search threads",
          }}
          filter={{
            customized: props?.conversationList
              ? isConversationListCustomized(props.conversationList)
              : false,
            items: buildHomeListFilterMenuItems({
              environments: [],
              projects: [],
              selectedEnvironmentId: null,
              selectedProjectKey: null,
              onEnvironmentChange: props?.onEnvironmentChange ?? (() => {}),
              onProjectChange: () => {},
              ...props?.conversationList,
            }),
          }}
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

it("includes sort and group actions and routes sort events to conversationList controls", () => {
  const onEnvironmentChange = vi.fn();
  const onConversationSortOrderChange = vi.fn();
  const onConversationGroupingChange = vi.fn();
  const conversationList: ConversationListControls = {
    conversationSortOrder: "updated_at",
    conversationGrouping: "none",
    onConversationSortOrderChange,
    onConversationGroupingChange,
  };

  using screen = setup({ conversationList, onEnvironmentChange });
  screen.render();

  expect(harness.lastAppBarProps).not.toBeNull();
  const filterMenu = harness.lastAppBarProps.menus?.[0];
  expect(filterMenu).toBeDefined();
  expect(filterMenu.title).toBe("Filter threads");

  const sortSubmenu = filterMenu.items.find((item: any) => item.id === "sort");
  expect(sortSubmenu).toBeDefined();
  expect(sortSubmenu.title).toBe("Sort conversations");

  const groupSubmenu = filterMenu.items.find((item: any) => item.id === "grouping");
  expect(groupSubmenu).toBeDefined();
  expect(groupSubmenu.title).toBe("Group conversations");

  const createdChoice = sortSubmenu.items.find((sub: any) => sub.id === "sort:created_at");
  expect(createdChoice).toBeDefined();
  createdChoice.onPress();

  expect(onConversationSortOrderChange).toHaveBeenCalledWith("created_at");
  expect(onEnvironmentChange).not.toHaveBeenCalled();

  const machineChoice = groupSubmenu.items.find((sub: any) => sub.id === "grouping:machine");
  expect(machineChoice).toBeDefined();
  machineChoice.onPress();

  expect(onConversationGroupingChange).toHaveBeenCalledWith("machine");
  expect(onEnvironmentChange).not.toHaveBeenCalled();
});
