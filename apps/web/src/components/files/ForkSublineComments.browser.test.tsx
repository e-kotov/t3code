import { DEFAULT_THEMES, preloadHighlighter } from "@pierre/diffs";
import { EnvironmentId, ThreadId, type ProjectReadFileResult } from "@t3tools/contracts";
import { createAssistantTextSelector } from "@t3tools/shared/assistantCitations";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { useComposerDraftStore } from "~/composerDraftStore";
import { reviewCommentContextRecord, reviewCommentFromRecord } from "~/lib/composerContextRecords";
import "../../index.css";
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
  useRenderedAppearance: () => "dark" as const,
}));
vi.mock(import("~/hooks/useWorkspaceMutationRefresh"), () => ({
  useWorkspaceMutationRefresh: vi.fn(),
}));
vi.mock(import("../DiffWorkerPoolProvider"), () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
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

import FilePreviewPanel from "./FilePreviewPanel";
import { buildSublineFileReviewComment } from "./forkFileSublineComments";

const environmentId = EnvironmentId.make("subline-comments-test");
const threadRef = { environmentId, threadId: ThreadId.make("thread") };

function setup(renderMarkdown: boolean) {
  const keys = ["t3code.fileExplorerOpen", "t3code.renderMarkdown"];
  const previous = keys.map((key) => localStorage.getItem(key));
  localStorage.setItem(keys[0]!, "false");
  localStorage.setItem(keys[1]!, String(renderMarkdown));
  state.optimistic = null;
  useComposerDraftStore.getState().clearComposerContent(threadRef);
  state.writeFile.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  return {
    [Symbol.dispose]() {
      window.getSelection()?.removeAllRanges();
      useComposerDraftStore.getState().clearComposerContent(threadRef);
      for (const [index, key] of keys.entries()) {
        const value = previous[index];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}

function preview(relativePath: string, contents: string) {
  state.file = { relativePath, contents, byteLength: contents.length, truncated: false };
  return (
    <div style={{ display: "flex", width: 900, height: 650 }}>
      <FilePreviewPanel
        environmentId={environmentId}
        cwd="/workspace/project"
        projectName="Project"
        relativePath={relativePath}
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

async function selectDomRange(
  target: HTMLElement,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
) {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        isPrimary: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
    window.getSelection()?.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
    target.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        isPrimary: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
    target.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        composed: true,
        button: 0,
      }),
    );
  });
}

function findTextNode(root: Node, needle: string): { node: Text; index: number } {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const text = current as Text;
    const index = text.data.indexOf(needle);
    if (index >= 0) return { node: text, index };
  }
  throw new Error(`Could not find text node containing "${needle}"`);
}

function highlightedText(name: string): string[] {
  return [...(CSS.highlights.get(name) ?? [])].map((range) => range.toString());
}

function shadow(screen: Screen) {
  return screen.container.querySelector("diffs-container")?.shadowRoot;
}

it("creates, highlights, views, and deletes a subline comment in rendered Markdown", async () => {
  using _settings = setup(true);
  await page.viewport(1200, 900);
  const markdown = "# Guide\n\nPlease **clarify the retry limit** before shipping.\n";
  await using screen = await render(preview("docs/guide.md", markdown));

  const phraseLocator = screen.getByText("clarify the retry limit", { exact: true });
  await expect.element(phraseLocator).toBeVisible();
  const phraseElement = phraseLocator.element() as HTMLElement;
  const surface = screen.container.querySelector<HTMLElement>("[data-markdown-comment-surface]")!;
  const found = findTextNode(phraseElement, "clarify the retry limit");
  await selectDomRange(
    surface,
    found.node,
    found.index,
    found.node,
    found.index + "clarify the retry limit".length,
  );

  const commentButton = page.getByRole("button", { name: "Add a comment" });
  await expect.element(commentButton).toBeVisible();
  await userEvent.click(commentButton);

  await vi.waitFor(() =>
    expect(CSS.highlights.get("t3-file-markdown-comment-draft")?.size).toBe(1),
  );
  const input = page.getByRole("textbox", {
    name: 'Comment on lines L3 · "clarify the retry limit"',
  });
  await expect.element(input).toBeVisible();
  await input.fill("Explain exponential backoff.");
  await userEvent.click(page.getByRole("button", { name: "Comment", exact: true }));

  const comments =
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [];
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({
    filePath: "docs/guide.md",
    sectionId: "file-rendered:docs/guide.md",
    startIndex: 2,
    endIndex: 2,
    rangeLabel: 'L3 · "clarify the retry limit"',
    diff: "clarify the retry limit",
    text: "Explain exponential backoff.",
    quote: {
      text: "clarify the retry limit",
    },
  });

  await vi.waitFor(() => expect(CSS.highlights.get("t3-file-markdown-comment")?.size).toBe(1));
  const pill = screen.getByRole("button", { name: 'L3 · "clarify the retry limit"' });
  await expect.element(pill).toBeVisible();
  await userEvent.click(pill);
  await expect
    .element(page.getByText("Explain exponential backoff.", { exact: true }))
    .toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Delete comment" }));
  expect(
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [],
  ).toHaveLength(0);
  expect(state.writeFile).not.toHaveBeenCalled();
});

it("creates and restores subline comments from text selections in read-only external source files", async () => {
  using _settings = setup(false);
  await page.viewport(1200, 900);
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["markdown"] });
  const path = "/outside/review-subline.qmd";
  const contents = "Title\nFirst sentence. Keep the second sentence short.\n";
  await using screen = await render(preview(path, contents));

  await expect
    .element(screen.getByText("First sentence. Keep the second sentence short.", { exact: true }))
    .toBeVisible();
  const row = shadow(screen)!.querySelector<HTMLElement>('[data-line="2"]')!;
  const found = findTextNode(row, "second sentence");
  await selectDomRange(
    row,
    found.node,
    found.index,
    found.node,
    found.index + "second sentence".length,
  );

  const commentButton = page.getByRole("button", { name: "Add a comment" });
  await expect.element(commentButton).toBeVisible();
  await userEvent.click(commentButton);

  const input = screen.getByRole("textbox", {
    name: 'Comment on lines L2 · "second sentence"',
  });
  await expect.element(input).toBeVisible();
  await input.fill("Split this clause.");
  await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));

  const comments =
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [];
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({
    filePath: path,
    sectionId: `file:${path}`,
    startIndex: 1,
    endIndex: 1,
    rangeLabel: 'L2:26 · "second sentence"',
    diff: "second sentence",
    text: "Split this clause.",
    quote: {
      text: "second sentence",
    },
  });
  await vi.waitFor(() =>
    expect(highlightedText("t3-file-source-comment")).toEqual(["second sentence"]),
  );

  const titleRow = shadow(screen)!.querySelector<HTMLElement>('[data-line="1"]')!;
  const title = findTextNode(titleRow, "Title");
  const first = findTextNode(row, "First");
  await selectDomRange(titleRow, title.node, title.index + 2, first.node, first.index + 5);
  await userEvent.click(page.getByRole("button", { name: "Add a comment" }));
  await expect
    .element(screen.getByRole("textbox", { name: 'Comment on lines L1 to L2 · "tle First"' }))
    .toBeVisible();
  await vi.waitFor(() => expect(CSS.highlights.get("t3-file-source-comment-draft")?.size).toBe(1));

  await screen.unmount();
  await using reopened = await render(preview(path, contents));
  await expect.element(reopened.getByText("Split this clause.", { exact: true })).toBeVisible();
  expect(state.writeFile).not.toHaveBeenCalled();
});

it("creates subline comments from text selections in editable workspace source files", async () => {
  using _settings = setup(false);
  await page.viewport(1200, 900);
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["typescript"] });
  const contents = "const retryCount = 3;\nconst timeoutMs = 5000;\n";
  await using screen = await render(preview("src/config.ts", contents));

  const editor = screen.getByRole("textbox", { name: "src/config.ts" });
  await expect.element(editor).toBeVisible();
  await vi.waitFor(() =>
    expect(shadow(screen)?.querySelector('[data-line="1"]')?.textContent).toContain("retryCount"),
  );
  await userEvent.click(editor);
  const row = shadow(screen)!.querySelector<HTMLElement>('[data-line="1"]')!;
  const found = findTextNode(row, "retryCount");
  await selectDomRange(row, found.node, found.index, found.node, found.index + "retryCount".length);

  const commentButton = page.getByRole("button", { name: "Add a comment" });
  await expect.element(commentButton).toBeVisible();
  await userEvent.click(commentButton);

  const input = screen.getByRole("textbox", {
    name: 'Comment on lines L1 · "retryCount"',
  });
  await expect.element(input).toBeVisible();
  await input.fill("Rename to maxRetries.");
  await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));

  const comments =
    useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments ?? [];
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({
    filePath: "src/config.ts",
    sectionId: "file:src/config.ts",
    startIndex: 0,
    endIndex: 0,
    rangeLabel: 'L1:7 · "retryCount"',
    diff: "retryCount",
    text: "Rename to maxRetries.",
    quote: {
      text: "retryCount",
    },
  });

  // Context import adds a comment, without its quote, while the file is open.
  const start = contents.indexOf("timeoutMs");
  const imported = buildSublineFileReviewComment({
    id: "imported-comment",
    filePath: "src/config.ts",
    sectionKind: "file",
    text: "Use seconds.",
    quote: createAssistantTextSelector(contents, start, start + "timeoutMs".length)!,
    contents,
    startLine: 2,
    endLine: 2,
  });
  await act(async () => {
    useComposerDraftStore
      .getState()
      .addReviewComment(threadRef, reviewCommentFromRecord(reviewCommentContextRecord(imported)));
  });
  await expect.element(screen.getByText("Use seconds.", { exact: true })).toBeVisible();
  await vi.waitFor(() =>
    expect(highlightedText("t3-file-source-comment").toSorted()).toEqual([
      "retryCount",
      "timeoutMs",
    ]),
  );
  await userEvent.click(screen.getByRole("button", { name: "Delete comment" }).nth(1));
  expect(
    useComposerDraftStore
      .getState()
      .getComposerDraft(threadRef)
      ?.reviewComments.map((comment) => comment.id),
  ).toEqual([comments[0]!.id]);
  expect(state.writeFile).not.toHaveBeenCalled();
});

function pointInRow(row: HTMLElement, column: number): { node: Text; offset: number } {
  let remaining = column;
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const text = current as Text;
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  throw new Error(`Row has no column ${column}`);
}

it("demotes an editable subline comment when an edit leaves only another occurrence", async () => {
  using _settings = setup(false);
  await page.viewport(1200, 900);
  await preloadHighlighter({ themes: Object.values(DEFAULT_THEMES), langs: ["typescript"] });
  const contents = "const a = x + x;\n";
  await using screen = await render(preview("src/a.ts", contents));

  const editor = screen.getByRole("textbox", { name: "src/a.ts" });
  await expect.element(editor).toBeVisible();
  await vi.waitFor(() =>
    expect(shadow(screen)?.querySelector('[data-line="1"]')?.textContent).toContain("x + x"),
  );
  await userEvent.click(editor);
  const row = () => shadow(screen)!.querySelector<HTMLElement>('[data-line="1"]')!;
  const second = [pointInRow(row(), 14), pointInRow(row(), 15)] as const;
  await selectDomRange(row(), second[0].node, second[0].offset, second[1].node, second[1].offset);
  await userEvent.click(page.getByRole("button", { name: "Add a comment" }));
  await screen.getByRole("textbox", { name: 'Comment on lines L1 · "x"' }).fill("Rename.");
  await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
  const stored = () => useComposerDraftStore.getState().getComposerDraft(threadRef)?.reviewComments;
  expect(stored()?.[0]?.rangeLabel).toBe('L1:15 · "x"');
  await vi.waitFor(() => expect(highlightedText("t3-file-source-comment")).toEqual(["x"]));

  // Select " + x" in the editor and delete it in one edit.
  await userEvent.click(editor);
  const from = pointInRow(row(), 11);
  const to = pointInRow(row(), 15);
  await act(async () => {
    window.getSelection()?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
  });
  await userEvent.keyboard("{Backspace}");
  await vi.waitFor(() => expect(state.optimistic?.contents).toBe("const a = x;\n"));

  await vi.waitFor(() =>
    expect(stored()?.[0]).toMatchObject({ rangeLabel: "L1", diff: "const a = x;" }),
  );
  expect(stored()?.[0]?.quote).toBeUndefined();
  await vi.waitFor(() => expect(highlightedText("t3-file-source-comment")).toEqual([]));
});
