import { expect, it } from "vite-plus/test";
import { validateCustomEditor } from "./customEditorDraft";
const editor = {
  id: "custom:test",
  name: "My editor",
  command: "/my tools/editor",
  args: ["{path}"],
  remoteUrl: "myeditor://ssh/{host}{path}",
  enabled: true,
};
it("validates commands separately from remote links", () => {
  expect(validateCustomEditor({ ...editor, remoteUrl: "" }, false)).toBeNull();
  expect(validateCustomEditor({ ...editor, command: "" }, true)).toBeNull();
  expect(validateCustomEditor({ ...editor, name: " " }, false)).toBeTruthy();
  expect(validateCustomEditor({ ...editor, command: "" }, false)).toBeTruthy();
  expect(validateCustomEditor({ ...editor, args: ["{unknown}"] }, false)).toBeTruthy();
  expect(validateCustomEditor({ ...editor, args: ["\0"] }, false)).toBeTruthy();
  expect(validateCustomEditor({ ...editor, remoteUrl: "file://{host}{path}" }, true)).toBeTruthy();
});
