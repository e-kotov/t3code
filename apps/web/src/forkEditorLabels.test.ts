import { expect, it } from "vite-plus/test";
import { configuredEditorLabel } from "./forkEditorLabels";

it("names opened editors for screen reader announcements", () => {
  expect(configuredEditorLabel("vscode", "MacIntel")).toBe("VS Code");
  expect(configuredEditorLabel("file-manager", "MacIntel")).toBe("Finder");
  expect(configuredEditorLabel("custom-editor", "MacIntel")).toBe("editor");
});
