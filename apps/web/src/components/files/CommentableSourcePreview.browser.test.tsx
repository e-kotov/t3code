import { EnvironmentId, ThreadId, type ProjectReadFileResult } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { act, render, type Screen } from "../../../test/render";

const state = vi.hoisted(() => ({
  file: null as ProjectReadFileResult | null,
  optimistic: null as ProjectReadFileResult | null,
  writeFile: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  runAtomCommand: ((_registry: unknown, _command: unknown, request: unknown) =>
    state.writeFile(request)) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("~/state/filesystem"), async (original) => ({
  ...(await original()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.writeFile) as never,
}));
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
vi.mock(import("~/remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenState: () => ({ mode: "local-exec" }) as never,
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ resolvedTheme: "dark" }) as never,
}));
vi.mock(import("~/hooks/useWorkspaceMutationRefresh"), () => ({
  useWorkspaceMutationRefresh: vi.fn(),
}));
vi.mock(import("./FileBreadcrumbs"), () => ({ FileBreadcrumbs: () => <></> }));
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  useProjectFileQuery: () => ({
    data: state.file,
    error: null,
    isPending: false,
    readError: null,
    isNotFile: false,
    isFile: true,
    refresh: vi.fn(),
  }),
  getOptimisticProjectFileQueryData: () => state.optimistic,
  getUnsavedProjectFileQueryData: () => null,
  setProjectFileQueryData: (
    _environmentId: EnvironmentId,
    _cwd: string,
    relativePath: string,
    contents: string,
  ) => {
    state.optimistic = { relativePath, contents, truncated: false, byteLength: contents.length };
  },
  confirmProjectFileQueryData: () => true,
}));

import { userEvent } from "vite-plus/test/browser";
import { useComposerDraftStore } from "~/composerDraftStore";
import FilePreviewPanel from "./FilePreviewPanel";

const environmentId = EnvironmentId.make("external-comments-test");
const threadRef = { environmentId, threadId: ThreadId.make("thread") };
function setup() {
  const keys = ["t3code.fileExplorerOpen", "t3code.renderMarkdown"];
  const previous = keys.map((key) => localStorage.getItem(key));
  localStorage.setItem(keys[0]!, "false");
  localStorage.setItem(keys[1]!, "true");
  state.optimistic = null;
  useComposerDraftStore.getState().clearComposerContent(threadRef);
  state.writeFile.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  return {
    [Symbol.dispose]() {
      useComposerDraftStore.getState().clearComposerContent(threadRef);
      for (const [index, key] of keys.entries()) {
        const value = previous[index];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}

const path = "/outside/review-2.qmd";
const contents = "Title\nFirst paragraph\nSecond paragraph\n";
function preview(truncated = false) {
  state.file = { relativePath: path, contents, byteLength: contents.length, truncated };
  return (
    <div style={{ display: "flex", width: 900, height: 650 }}>
      <FilePreviewPanel
        environmentId={environmentId}
        cwd="/workspace/scratch"
        projectName="Scratch"
        relativePath={path}
        threadRef={threadRef}
        composerDraftTarget={threadRef}
        keybindings={[]}
        availableEditors={[]}
        openInShortcutEnabled={false}
        revealLine={null}
        revealRequestId={0}
        onOpenFile={vi.fn()}
        onNavigateFolder={vi.fn()}
        folderTrail={undefined}
        onPendingChange={vi.fn()}
        selectedFilePending={false}
        workspaceMutationId={null}
      />
    </div>
  );
}
function shadow(screen: Screen) {
  return screen.container.querySelector("diffs-container")?.shadowRoot;
}
async function selectLines(screen: Screen, start: number, end = start) {
  await vi.waitFor(() =>
    expect(shadow(screen)?.querySelector(`[data-column-number="${start}"]`)).toBeTruthy(),
  );
  const first = shadow(screen)!.querySelector<HTMLElement>(`[data-column-number="${start}"]`)!;
  const last = shadow(screen)!.querySelector<HTMLElement>(`[data-column-number="${end}"]`)!;
  const down = first.getBoundingClientRect();
  const up = last.getBoundingClientRect();
  const options = { bubbles: true, composed: true, pointerId: 1, pointerType: "mouse", button: 0 };
  await act(() => {
    first.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...options,
        clientX: down.x + down.width / 2,
        clientY: down.y + down.height / 2,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        ...options,
        clientX: up.x + up.width / 2,
        clientY: up.y + up.height / 2,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        ...options,
        clientX: up.x + up.width / 2,
        clientY: up.y + up.height / 2,
      }),
    );
  });
}

it("attaches external-file line comments to this thread without writing the file", async () => {
  using _settings = setup();
  await using screen = await render(preview());
  await selectLines(screen, 3, 2);
  const input = screen.getByRole("textbox", { name: "Comment on lines L2 to L3" });
  await expect.element(input).toBeVisible();
  await input.fill("Please shorten these paragraphs.");
  await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
  const comments = useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments;
  expect(comments).toHaveLength(1);
  expect(comments![0]).toMatchObject({
    filePath: path,
    sectionId: `file:${path}`,
    startIndex: 1,
    endIndex: 2,
    rangeLabel: "L2 to L3",
    diff: "First paragraph\nSecond paragraph",
    text: "Please shorten these paragraphs.",
  });
  expect(state.writeFile).not.toHaveBeenCalled();
  expect(state.optimistic).toBeNull();
  expect(shadow(screen)?.querySelector('[contenteditable="true"]')).toBeNull();

  await screen.unmount();
  await using reopened = await render(preview());
  await expect
    .element(reopened.getByText("Please shorten these paragraphs.", { exact: true }))
    .toBeVisible();
  await selectLines(reopened, 1);
  const nextDraft = reopened.getByRole("textbox", { name: "Comment on lines L1" });
  await nextDraft.fill("Keep this unsent comment.");
  await userEvent.click(reopened.getByRole("button", { name: "Delete comment" }));
  await expect.element(nextDraft).toHaveValue("Keep this unsent comment.");
  await userEvent.click(reopened.getByRole("button", { name: "Cancel", exact: true }));
  expect(
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [],
  ).toHaveLength(0);
  expect(state.writeFile).not.toHaveBeenCalled();
});

it("cancels a single-line draft and keeps truncated source previews unannotated", async () => {
  using _settings = setup();
  await using screen = await render(preview());
  await selectLines(screen, 2);
  await expect.element(screen.getByRole("textbox", { name: "Comment on lines L2" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [],
  ).toHaveLength(0);
  await screen.rerender(preview(true));
  await expect
    .element(screen.getByRole("textbox", { name: /Comment on lines/ }))
    .not.toBeInTheDocument();
  expect(state.writeFile).not.toHaveBeenCalled();
});
