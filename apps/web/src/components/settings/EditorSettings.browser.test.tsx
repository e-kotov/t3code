import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { editorPreferencesKey } from "../../forkEditorPreferences";

import "~/index.css";

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      { environmentId: "mac", label: "Mac", serverConfig: { availableEditors: ["vscode"] } },
    ],
  })) as never,
}));
vi.mock(import("../../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteCapableEditors: () => ["vscode"],
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsSection: (props: Parameters<typeof import("./settingsLayout").SettingsSection>[0]) => (
    <>{props.children}</>
  ),
  SettingsRow: (props: Parameters<typeof import("./settingsLayout").SettingsRow>[0]) => (
    <>{props.children}</>
  ),
}));

import { EditorSettings } from "./EditorSettings";

async function choose(label: string, option: string) {
  await userEvent.click(page.getByRole("combobox", { name: label, exact: true }));
  await userEvent.click(page.getByRole("option", { name: option, exact: true }));
}

it("persists remote visibility independently of local custom commands, defaults and deletion", async () => {
  localStorage.clear();
  using _storage = { [Symbol.dispose]: () => localStorage.clear() };
  await using _screen = await render(<EditorSettings />);
  await choose("Gram visibility", "Always show");
  const remoteKey = editorPreferencesKey(null, true);
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({
    builtIns: [{ id: "gram", visibility: "show" }],
  });
  await choose("Editor configuration target", "Local commands on Mac");
  await userEvent.click(page.getByRole("button", { name: "Add custom editor" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Name", exact: true }), "My editor");
  await userEvent.fill(
    page.getByRole("textbox", { name: "Executable", exact: true }),
    "/my tools/editor",
  );
  await userEvent.fill(document.querySelector("textarea")!, "--goto\n{path}:{line}");
  await userEvent.click(page.getByRole("button", { name: "Save editor" }));
  const localKey = editorPreferencesKey(EnvironmentId.make("mac"), false);
  const saved = JSON.parse(localStorage.getItem(localKey)!);
  expect(saved.custom).toHaveLength(1);
  expect(saved.custom[0]).toMatchObject({
    name: "My editor",
    command: "/my tools/editor",
    args: ["--goto", "{path}:{line}"],
  });
  await choose("Default editor", "My editor");
  expect(JSON.parse(localStorage.getItem(localKey)!).preferred).toBe(saved.custom[0].id);
  await userEvent.click(page.getByRole("button", { name: "Remove", exact: true }));
  expect(JSON.parse(localStorage.getItem(localKey)!)).toMatchObject({
    custom: [],
    preferred: null,
  });
  expect(JSON.parse(localStorage.getItem(remoteKey)!)).toMatchObject({
    builtIns: [{ id: "gram", visibility: "show" }],
  });
});
