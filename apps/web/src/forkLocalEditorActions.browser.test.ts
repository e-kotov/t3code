import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { openSavedConfiguredEditor } from "./forkLocalEditorActions";
import {
  editorPreferencesKey,
  EMPTY_EDITOR_PREFERENCES,
  EditorPreferences,
} from "./forkEditorPreferences";
import { setLocalStorageItem } from "./hooks/useLocalStorage";
const environmentId = EnvironmentId.make("mac");
const invoke = vi.fn();
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset().mockResolvedValue(AsyncResult.success(undefined));
});
it("leaves existing behavior untouched when no editor configuration has been saved", async () => {
  expect(await openSavedConfiguredEditor(environmentId, ["vscode"], "/project", invoke)).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
it("uses saved custom commands for file actions and does not borrow another environment's settings", async () => {
  const custom = {
    id: "custom:test",
    name: "My editor",
    command: "editor",
    args: ["{path}:{line}"],
    remoteUrl: "",
    enabled: true,
  };
  setLocalStorageItem(
    editorPreferencesKey(environmentId, false),
    { ...EMPTY_EDITOR_PREFERENCES, custom: [custom], preferred: custom.id },
    EditorPreferences,
  );
  expect(
    await openSavedConfiguredEditor(environmentId, [], "/project/file.ts:8", invoke),
  ).toMatchObject({ _tag: "Success", value: custom.id });
  expect(invoke).toHaveBeenCalledWith({
    environmentId,
    input: {
      editor: "custom",
      cwd: "/project/file.ts:8",
      customEditor: { name: custom.name, command: custom.command, args: custom.args },
    },
  });
  expect(
    await openSavedConfiguredEditor(EnvironmentId.make("gwdg"), [], "/project", invoke),
  ).toBeNull();
});
it("does not fall back to a hidden editor", async () => {
  setLocalStorageItem(
    editorPreferencesKey(environmentId, false),
    { ...EMPTY_EDITOR_PREFERENCES, builtIns: [{ id: "vscode", visibility: "hide" }] },
    EditorPreferences,
  );
  expect(
    (await openSavedConfiguredEditor(environmentId, ["vscode"], "/project", invoke))?._tag,
  ).toBe("Failure");
  expect(invoke).not.toHaveBeenCalled();
});
