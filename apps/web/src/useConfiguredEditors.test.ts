import { EnvironmentId, EnvironmentAuthorizationError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { EditorPreferences } from "./forkEditorPreferences";

const state = vi.hoisted(() => ({
  allowed: false,
  remote: { mode: "local-exec" } as
    | { mode: "local-exec" }
    | { mode: "remote-links"; host: { kind: "ssh-alias"; host: string } }
    | { mode: "remote-unavailable" },
  preferences: { builtIns: [], custom: [], preferred: null } as EditorPreferences,
  invoke: vi.fn(),
  persist: vi.fn(),
  openExternal: vi.fn(),
  openCustom: vi.fn(),
  hintSeen: vi.fn(),
}));
vi.mock("./editorPreferences", () => ({ usePreferredEditor: () => [null, vi.fn()] }));
vi.mock("./hooks/useLocalStorage", () => ({
  useLocalStorage: (key: string) =>
    key === "t3code:last-editor" ? [null, vi.fn()] : [state.preferences, state.persist],
}));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.invoke }));
vi.mock("./state/session", () => ({ readEnvironmentScope: () => state.allowed }));
vi.mock("./remoteOpen", () => ({
  useRemoteOpenState: () => state.remote,
  useRemoteCapableEditors: () => ["vscode"],
  useRemoteOpenHint: () => [false, state.hintSeen],
  openRemoteEditorUrl: state.openExternal,
}));
import { useConfiguredEditors } from "./useConfiguredEditors";
const environmentId = EnvironmentId.make("test-environment");
const custom = {
  id: "custom:test",
  name: "My editor",
  command: "/tools/editor",
  args: ["{path}"],
  remoteUrl: "myeditor://ssh/{host}{path}",
  enabled: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.allowed = true;
  state.remote = { mode: "local-exec" };
  state.preferences = { builtIns: [], custom: [custom], preferred: custom.id };
  state.invoke.mockResolvedValue(AsyncResult.success(undefined));
  state.openExternal.mockResolvedValue(true);
  state.openCustom.mockResolvedValue(true);
  vi.stubGlobal("window", { desktopBridge: { openCustomEditor: state.openCustom } });
});
it("launches the selected custom command in the correct environment", async () => {
  expect(
    await useConfiguredEditors(environmentId, []).open("/my project/file.ts:8:2"),
  ).toMatchObject({ _tag: "Success", value: custom.id });
  expect(state.invoke).toHaveBeenCalledWith({
    environmentId,
    input: {
      cwd: "/my project/file.ts:8:2",
      editor: "custom",
      customEditor: { name: "My editor", command: "/tools/editor", args: ["{path}"] },
    },
  });
});
it("checks current permissions when a retained command callback runs", async () => {
  const { open } = useConfiguredEditors(environmentId, []);
  state.allowed = false;
  const result = await open("/project");
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure")
    expect(Cause.squash(result.cause)).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(state.invoke).not.toHaveBeenCalled();
  expect(state.persist).not.toHaveBeenCalled();
});
it("opens a remote custom link on the viewing device without launching on the server", async () => {
  state.allowed = false;
  state.remote = { mode: "remote-links", host: { kind: "ssh-alias", host: "gwdg" } };
  expect((await useConfiguredEditors(environmentId, []).open("/my project"))._tag).toBe("Success");
  expect(state.openCustom).toHaveBeenCalledWith({
    template: custom.remoteUrl,
    host: "gwdg",
    target: "/my project",
  });
  expect(state.invoke).not.toHaveBeenCalled();
});
it("does not record success when an older desktop cannot open custom links", async () => {
  state.remote = { mode: "remote-links", host: { kind: "ssh-alias", host: "gwdg" } };
  vi.stubGlobal("window", { desktopBridge: {} });
  expect((await useConfiguredEditors(environmentId, []).open("/project"))._tag).toBe("Failure");
  expect(state.persist).not.toHaveBeenCalled();
  expect(state.hintSeen).not.toHaveBeenCalled();
});
it("does not launch when the SSH route is absent", async () => {
  state.remote = { mode: "remote-unavailable" };
  expect((await useConfiguredEditors(environmentId, []).open("/project"))._tag).toBe("Failure");
  expect(state.invoke).not.toHaveBeenCalled();
});
it("keeps the preference unchanged after a failed launch", async () => {
  state.invoke.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("missing executable"))));
  expect((await useConfiguredEditors(environmentId, []).open("/project"))._tag).toBe("Failure");
  expect(state.persist).not.toHaveBeenCalled();
});
it("asks the file manager to reveal only when the caller requests it", async () => {
  const { open } = useConfiguredEditors(environmentId, ["file-manager"]);
  await open("/project/file.ts", "file-manager", { revealFileManager: true });
  await open("/project/file.ts", "file-manager");
  await open("/project/file.ts", custom.id, { revealFileManager: true });
  expect(state.invoke.mock.calls.map(([call]) => call.input)).toEqual([
    { cwd: "/project/file.ts", editor: "file-manager", reveal: true },
    { cwd: "/project/file.ts", editor: "file-manager" },
    {
      cwd: "/project/file.ts",
      editor: "custom",
      customEditor: { name: "My editor", command: "/tools/editor", args: ["{path}"] },
    },
  ]);
});

it("preserves upstream remote file targeting for configured built-in editors", async () => {
  state.remote = { mode: "remote-links", host: { kind: "ssh-alias", host: "gwdg" } };
  state.preferences = { builtIns: [], custom: [], preferred: null };
  const { open } = useConfiguredEditors(environmentId, []);
  await open("/project/file.ts", "vscode", { isFile: true });
  await open("/project", "vscode");
  expect(state.openExternal.mock.calls).toEqual([
    ["vscode://vscode-remote/ssh-remote+gwdg/project/file.ts:1:1"],
    ["vscode://vscode-remote/ssh-remote+gwdg/project"],
  ]);
});

afterEach(() => vi.unstubAllGlobals());
