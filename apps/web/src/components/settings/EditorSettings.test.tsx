// @vitest-environment jsdom
import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { editorPreferencesKey } from "../../forkEditorPreferences";

vi.mock("../../state/environments", () => ({ useEnvironments: () => ({ environments: [{ environmentId: "mac", label: "Mac", serverConfig: { availableEditors: ["vscode"] } }] }) }));
vi.mock("../../remoteOpen", () => ({ useRemoteCapableEditors: () => ["vscode"] }));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => children,
  SettingsRow: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/select", async () => {
  const { Children, isValidElement } = await import("react");
  return {
    Select: ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (value: string) => void }) => {
      const trigger = Children.toArray(children).find((child) => isValidElement<{ "aria-label"?: string }>(child) && child.props["aria-label"]);
      const label = isValidElement<{ "aria-label"?: string }>(trigger) ? trigger.props["aria-label"] : undefined;
      return <select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>;
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectPopup: ({ children }: { children: ReactNode }) => children,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
  };
});
vi.mock("../ui/button", () => ({ Button: (props: object) => <button {...props} /> }));
vi.mock("../ui/input", () => ({ Input: (props: object) => <input {...props} /> }));
vi.mock("../ui/textarea", () => ({ Textarea: (props: object) => <textarea {...props} /> }));
vi.mock("../ui/dialog", async () => {
  const { cloneElement } = await import("react");
  const Group = ({ children }: { children: ReactNode }) => children;
  return { Dialog: Group, DialogHeader: Group, DialogTitle: Group, DialogDescription: Group, DialogPanel: Group, DialogFooter: Group,
    DialogPopup: ({ render, children }: { render: React.ReactElement; children: ReactNode }) => cloneElement(render, {}, children) };
});
import { EditorSettings } from "./EditorSettings";
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await act(() => renderer?.unmount()); vi.unstubAllGlobals(); });
function select(label: string) { return renderer!.root.findAllByType("select").find((node) => node.props["aria-label"] === label)!; }
function button(label: string) { return renderer!.root.findAllByType("button").find((node) => node.children.join("") === label)!; }

it("persists remote visibility independently of local custom commands, defaults and deletion", async () => {
  await act(() => { renderer = create(<EditorSettings />); });
  await act(() => select("Gram visibility").props.onChange({ target: { value: "show" } }));
  const remoteKey = editorPreferencesKey(null, true);
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({ builtIns: [{ id: "gram", visibility: "show" }] });
  await act(() => select("Editor configuration target").props.onChange({ target: { value: "mac" } }));
  await act(() => button("Add custom editor").props.onClick());
  const inputs = renderer!.root.findAllByType("input");
  await act(() => inputs[0]!.props.onChange({ target: { value: "My editor" } }));
  await act(() => inputs[1]!.props.onChange({ target: { value: "/my tools/editor" } }));
  await act(() => renderer!.root.findByType("textarea").props.onChange({ target: { value: "--goto\n{path}:{line}" } }));
  await act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
  const localKey = editorPreferencesKey(EnvironmentId.make("mac"), false);
  const saved = JSON.parse(localStorage.getItem(localKey)!);
  expect(saved.custom).toHaveLength(1);
  expect(saved.custom[0]).toMatchObject({ name: "My editor", command: "/my tools/editor", args: ["--goto", "{path}:{line}"] });
  await act(() => select("Default editor").props.onChange({ target: { value: saved.custom[0].id } }));
  expect(JSON.parse(localStorage.getItem(localKey)!).preferred).toBe(saved.custom[0].id);
  await act(() => button("Remove").props.onClick());
  expect(JSON.parse(localStorage.getItem(localKey)!)).toMatchObject({ custom: [], preferred: null });
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({ builtIns: [{ id: "gram", visibility: "show" }] });
});
