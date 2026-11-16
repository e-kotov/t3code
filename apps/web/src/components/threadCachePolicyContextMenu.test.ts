import { expect, it, vi } from "vite-plus/test";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  type ContextMenuItem,
  type ContextMenuSource,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  selected: null as string | null,
  canWrite: true,
  source: undefined as ContextMenuSource | undefined,
  items: [] as readonly ContextMenuItem[],
  write: vi.fn(),
}));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => DEFAULT_SERVER_SETTINGS } }));
vi.mock("../state/server", () => ({
  serverEnvironment: { settingsValueAtom: () => "settings", updateSettings: "update" },
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (_env: string, scope: string) =>
    scope === AuthSettingsWriteScope && state.canWrite,
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (...args: unknown[]) => {
    state.write(...args);
    return Promise.resolve({ _tag: "Success" });
  },
}));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({
    contextMenu: {
      show: (items: readonly ContextMenuItem[], _position: unknown, source?: ContextMenuSource) => {
        state.source = source;
        state.items = items;
        return Promise.resolve(state.selected);
      },
    },
  }),
}));
vi.mock("../state/entities", () => ({ readProject: vi.fn() }));
vi.mock("./ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: unknown) => value,
}));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ addThreadContexts: vi.fn() }) },
}));

import { showThreadCachePolicyMenu } from "./threadCachePolicyContextMenu";
const thread = {
  environmentId: EnvironmentId.make("remote-machine"),
  id: ThreadId.make("thread"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude" },
  cacheHud: null,
};

it("adds a checked per-thread menu while preserving ordinary actions and targets the correct remote machine", async () => {
  state.selected = "rename";
  expect(
    await showThreadCachePolicyMenu(
      thread,
      [{ id: "rename", label: "Rename" }],
      undefined,
      undefined,
      "keyboard",
    ),
  ).toBe("rename");
  expect(state.source).toBe("keyboard");
  expect(state.items[0]).toEqual({ id: "rename", label: "Rename" });
  expect(
    state.items[1]?.children?.find((choice) => choice.id === "cache-policy:default")?.checked,
  ).toBe(true);
  state.source = undefined;
  expect(
    await showThreadCachePolicyMenu(
      { ...thread, projectId: ProjectId.make("project"), title: "Thread" },
      [{ id: "rename", label: "Rename" }],
      undefined,
      async () => null,
      "keyboard",
    ),
  ).toBe("rename");
  expect(state.source).toBe("keyboard");
  state.selected = "cache-policy:warm";
  expect(await showThreadCachePolicyMenu(thread, [])).toBeNull();
  expect(state.write).toHaveBeenCalledWith(
    expect.anything(),
    "update",
    {
      environmentId: thread.environmentId,
      input: { patch: { threadCachePolicies: { [thread.id]: "warm" } } },
    },
    expect.anything(),
  );
});

it("requires settings permission even when a menu implementation returns a disabled action", async () => {
  state.canWrite = false;
  state.selected = "cache-policy:off";
  state.write.mockClear();
  await showThreadCachePolicyMenu(thread, []);
  expect(state.items[0]?.children?.every((choice) => choice.disabled)).toBe(true);
  expect(state.write).not.toHaveBeenCalled();
  state.canWrite = true;
});
