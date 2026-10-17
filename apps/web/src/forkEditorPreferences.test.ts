import { describe, expect, it } from "vite-plus/test";
import {
  configuredEditorEntries,
  editorPreferencesKey,
  EMPTY_EDITOR_PREFERENCES,
  preferredConfiguredEditor,
  resolveEditorPreferences,
  setEditorVisibility,
  type CustomEditor,
} from "./forkEditorPreferences";

const custom: CustomEditor = {
  id: "custom:my-editor",
  name: "My editor",
  command: "myeditor",
  args: ["{path}"],
  remoteUrl: "myeditor://ssh/{host}{path}",
  enabled: true,
};

describe("configured editors", () => {
  it.each(["vscode", null, {}])("retains detected editors with legacy or missing preferences: %j", (saved) => {
    const preferences = resolveEditorPreferences(saved);
    const entries = configuredEditorEntries(preferences, ["vscode"], false);
    expect(preferredConfiguredEditor(entries, preferences.preferred, "vscode")?.id).toBe("vscode");
  });
  it("keeps detection by default and allows explicit visibility overrides", () => {
    expect(
      configuredEditorEntries(EMPTY_EDITOR_PREFERENCES, ["vscode"], false).map((entry) => entry.id),
    ).toEqual(["vscode"]);
    const preferences = setEditorVisibility(
      setEditorVisibility(EMPTY_EDITOR_PREFERENCES, "vscode", "hide"),
      "positron",
      "show",
    );
    expect(
      configuredEditorEntries(preferences, ["vscode"], false).map((entry) => entry.id),
    ).toEqual(["positron"]);
    expect(
      configuredEditorEntries(
        setEditorVisibility(preferences, "positron", "auto"),
        ["vscode"],
        false,
      ),
    ).toEqual([]);
  });
  it("offers manually enabled remote editors without a browser probe", () => {
    const preferences = setEditorVisibility(
      setEditorVisibility(EMPTY_EDITOR_PREFERENCES, "gram", "show"),
      "file-manager",
      "show",
    );
    expect(configuredEditorEntries(preferences, [], true).map((entry) => entry.id)).toEqual([
      "gram",
    ]);
  });
  it("offers custom editors only in modes they are configured for", () => {
    const preferences = {
      ...EMPTY_EDITOR_PREFERENCES,
      custom: [
        custom,
        { ...custom, id: "disabled", enabled: false },
        { ...custom, id: "local-only", remoteUrl: "" },
      ],
    };
    expect(configuredEditorEntries(preferences, [], true).map((entry) => entry.id)).toEqual([
      custom.id,
    ]);
    expect(configuredEditorEntries(preferences, [], false).map((entry) => entry.id)).toEqual([
      custom.id,
      "local-only",
    ]);
  });
  it("falls back when the default is hidden or deleted", () => {
    const entries = configuredEditorEntries(
      { ...EMPTY_EDITOR_PREFERENCES, custom: [custom] },
      ["vscode"],
      false,
    );
    expect(preferredConfiguredEditor(entries, custom.id, "vscode")?.id).toBe(custom.id);
    expect(preferredConfiguredEditor(entries, "deleted", "vscode")?.id).toBe("vscode");
    expect(preferredConfiguredEditor([], custom.id, "vscode")).toBeNull();
  });
  it("isolates commands by environment while sharing remote links on this device", () => {
    expect(editorPreferencesKey("mac", false)).not.toBe(editorPreferencesKey("gwdg", false));
    expect(editorPreferencesKey("mac", true)).toBe(editorPreferencesKey("gwdg", true));
    expect(editorPreferencesKey("mac", true)).not.toBe(editorPreferencesKey("mac", false));
  });
});
