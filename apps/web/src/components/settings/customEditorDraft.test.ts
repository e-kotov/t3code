import { m, type MessageResolver } from "../../i18n/messages";
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

it("resolves validation copy at render time and preserves literal URL placeholders", () => {
  const resolve = ((message: string) => `translated:${m(message)}`) as MessageResolver;
  expect(validateCustomEditor({ ...editor, name: "" }, false, resolve)).toBe(
    "translated:Enter an editor name.",
  );
  expect(validateCustomEditor({ ...editor, remoteUrl: "" }, true)).toBe(
    "Use an app URL with {host} and {path} (or {pathQuery}), for example myeditor://ssh/{host}{path}.",
  );
  expect(validateCustomEditor({ ...editor, args: ["{unknown}"] }, false)).toBe(
    "Supported argument placeholders: {path}, {line}, {column}.",
  );
});
