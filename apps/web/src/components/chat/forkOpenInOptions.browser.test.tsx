import { EnvironmentId, type EditorId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { OpenInPicker } from "./OpenInPicker";

vi.mock("../../useConfiguredEditors", async () => {
  const { configuredEditorEntries, EMPTY_EDITOR_PREFERENCES } = await import("../../forkEditorPreferences");
  const { AsyncResult } = await import("effect/reactivity");
  return {
    useConfiguredEditors: (_environmentId: string, editors: readonly EditorId[]) => ({
      entries: configuredEditorEntries(EMPTY_EDITOR_PREFERENCES, editors, false),
      preferredEditor: editors[0] ?? null,
      setPreferredEditor: () => {},
      open: async () => AsyncResult.success(undefined),
      remote: { mode: "local-exec" },
      remoteHintSeen: true,
    }),
  };
});
vi.mock("../../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
}));
vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  useEnvironment: () => ({ label: "Test host" }),
}));

it.each(["MacIntel", "Win32", "Linux x86_64"])("offers detected fork editors on %s", async (platform) => {
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  await using screen = await render(
    <OpenInPicker
      environmentId={EnvironmentId.make("test-host")}
      keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
      availableEditors={["positron", "gram"]}
      openInCwd="/project"
    />,
  );
  await screen.getByRole("button", { name: "Choose editor" }).click();
  await expect.element(screen.getByRole("menuitem", { name: "Positron", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("menuitem", { name: "Gram", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("menuitem", { name: "Visual Studio Code", exact: true })).not.toBeInTheDocument();
});
