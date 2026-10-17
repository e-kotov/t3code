import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { editorPreferencesKey } from "../../forkEditorPreferences";

vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  useEnvironments: () => ({
    environments: [
      { environmentId: "mac", label: "Mac", serverConfig: { availableEditors: ["vscode"] } },
    ],
  }),
}));
vi.mock("../../remoteOpen", async (original) => ({
  ...(await original<typeof import("../../remoteOpen")>()),
  useRemoteCapableEditors: () => ["vscode"],
}));
vi.mock("./settingsLayout", async (original) => ({
  ...(await original<typeof import("./settingsLayout")>()),
  SettingsSection: ({ children }: { children: ReactNode }) => children,
  SettingsRow: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/select", async (original) => {
  const { Children, isValidElement } = await import("react");
  return {
    ...(await original<typeof import("../ui/select")>()),
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children: ReactNode;
      value: string;
      onValueChange: (value: string) => void;
    }) => {
      const trigger = Children.toArray(children).find(
        (child) => isValidElement<{ "aria-label"?: string }>(child) && child.props["aria-label"],
      );
      const label = isValidElement<{ "aria-label"?: string }>(trigger)
        ? trigger.props["aria-label"]
        : undefined;
      return (
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {children}
        </select>
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectPopup: ({ children }: { children: ReactNode }) => children,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
      <option value={value}>{children}</option>
    ),
  };
});
vi.mock("../ui/button", async (original) => ({
  ...(await original<typeof import("../ui/button")>()),
  Button: (props: object) => <button {...props} />,
}));
vi.mock("../ui/input", async (original) => ({
  ...(await original<typeof import("../ui/input")>()),
  Input: (props: object) => <input {...props} />,
}));
vi.mock("../ui/textarea", async (original) => ({
  ...(await original<typeof import("../ui/textarea")>()),
  Textarea: (props: object) => <textarea {...props} />,
}));
vi.mock("../ui/dialog", async (original) => {
  const { cloneElement } = await import("react");
  const Group = ({ children }: { children: ReactNode }) => children;
  return {
    ...(await original<typeof import("../ui/dialog")>()),
    Dialog: Group,
    DialogHeader: Group,
    DialogTitle: Group,
    DialogDescription: Group,
    DialogPanel: Group,
    DialogFooter: Group,
    DialogPopup: ({ render, children }: { render: React.ReactElement; children: ReactNode }) =>
      cloneElement(render, {}, children),
  };
});
import { EditorSettings } from "./EditorSettings";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function select(label: string) {
  return container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
async function change(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const prototype = control instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }));
  });
}

it("persists remote visibility independently of local custom commands, defaults and deletion", async () => {
  await act(async () => root.render(<EditorSettings />));
  await change(select("Gram visibility"), "show");
  const remoteKey = editorPreferencesKey(null, true);
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({
    builtIns: [{ id: "gram", visibility: "show" }],
  });
  await change(select("Editor configuration target"), "mac");
  await act(async () => button("Add custom editor").click());
  const inputs = container.querySelectorAll<HTMLInputElement>("input");
  await change(inputs[0]!, "My editor");
  await change(inputs[1]!, "/my tools/editor");
  await change(container.querySelector("textarea")!, "--goto\n{path}:{line}");
  await act(async () => container.querySelector("form")!.requestSubmit());
  const localKey = editorPreferencesKey(EnvironmentId.make("mac"), false);
  const saved = JSON.parse(localStorage.getItem(localKey)!);
  expect(saved.custom).toHaveLength(1);
  expect(saved.custom[0]).toMatchObject({
    name: "My editor",
    command: "/my tools/editor",
    args: ["--goto", "{path}:{line}"],
  });
  await change(select("Default editor"), saved.custom[0].id);
  expect(JSON.parse(localStorage.getItem(localKey)!).preferred).toBe(saved.custom[0].id);
  await act(async () => button("Remove").click());
  expect(JSON.parse(localStorage.getItem(localKey)!)).toMatchObject({
    custom: [],
    preferred: null,
  });
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({
    builtIns: [{ id: "gram", visibility: "show" }],
  });
});
