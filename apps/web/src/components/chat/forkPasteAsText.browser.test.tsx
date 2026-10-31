import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type AuthEnvironmentScope,
  type EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type { Editor } from "@tiptap/core";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import { serializeEditorDoc } from "~/composer-rich-text-doc";
import { composerTargetKey, DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { DESKTOP_PASTE_AS_TEXT_EVENT } from "~/lib/desktopPasteAsText";
import { isMacPlatform } from "~/lib/utils";
import { getRouter } from "~/router";
import { countPreparingComposerImages } from "./preparingComposerImages";
import { isTextOnlyPasteEvent } from "./forkPasteAsText";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

vi.mock(import("~/state/session"), async (original) => {
  const actual = await original();
  const canOperate = (scope: AuthEnvironmentScope) => scope === AuthOrchestrationOperateScope;
  return {
    ...actual,
    readEnvironmentScope: (environmentId: EnvironmentId, scope: AuthEnvironmentScope) =>
      canOperate(scope) || actual.readEnvironmentScope(environmentId, scope),
    useEnvironmentScope: (environmentId: EnvironmentId | null, scope: AuthEnvironmentScope) => {
      const allowed = actual.useEnvironmentScope(environmentId, scope);
      return canOperate(scope) || allowed;
    },
  };
});

async function mountDraft(draftName: string) {
  const stack = new AsyncDisposableStack();
  stack.use(installFakeEnvironment([]));
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const draftId = DraftId.make(`draft-${draftName}`);
  const threadId = ThreadId.make(`thread-${draftName}`);
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });
  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  const app = stack.use(await render(<AppRoot router={router} />, { router: false }));
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();
  const disposable = stack.move();
  return Object.assign(app, {
    draftId,
    [Symbol.asyncDispose]: () => disposable.disposeAsync(),
  });
}

function editorIn(container: HTMLElement): Editor {
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  return element.editor;
}

function pasteAsTextShortcut() {
  return new KeyboardEvent("keydown", {
    key: "v",
    shiftKey: true,
    metaKey: isMacPlatform(navigator.platform),
    ctrlKey: !isMacPlatform(navigator.platform),
    bubbles: true,
  });
}

function screenshotClipboard(text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const imageBytes = Uint8Array.from(
    atob(
      [
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAY",
        "AAjCB0C8AAAAASUVORK5CYII=",
      ].join(""),
    ),
    (character) => character.charCodeAt(0),
  ).buffer;
  clipboardData.items.add(new File([imageBytes], "screenshot.png", { type: "image/png" }));
  return clipboardData;
}

it("keeps selection, editor paste handling, and image suppression for a focused paste", async () => {
  await using app = await mountDraft("paste-focused");
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await act(async () => {
    editorIn(app.container).commands.setContent("prefix old suffix");
  });
  await act(async () => {
    const editor = editorIn(app.container);
    expect(editor.view.dom.isConnected).toBe(true);
    editor.view.focus();
    expect(document.activeElement).toBe(editor.view.dom);
    editor.commands.setTextSelection({ from: 8, to: 11 });
    editor.view.dom.dispatchEvent(pasteAsTextShortcut());
    editor.view.dom.dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT, { bubbles: true }));
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: screenshotClipboard("replacement"),
    });
    editor.view.dom.dispatchEvent(paste);
    expect(isTextOnlyPasteEvent(paste)).toBe(true);
    expect(paste.defaultPrevented).toBe(true);
  });

  const editor = editorIn(app.container);
  expect(serializeEditorDoc(editor.state.doc).value).toBe("prefix replacement suffix");
  expect(useComposerDraftStore.getState().getComposerDraft(app.draftId)?.images).toHaveLength(0);
  expect(countPreparingComposerImages(composerTargetKey(app.draftId))).toBe(0);
  await act(async () => {
    editor.commands.undo();
  });
  expect(serializeEditorDoc(editor.state.doc).value).toBe("prefix old suffix");
});

it("routes a text-plus-image paste from the timeline into the composer", async () => {
  await using app = await mountDraft("paste-unfocused");
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  const editor = editorIn(app.container);

  await act(async () => {
    document.body.dispatchEvent(new Event(DESKTOP_PASTE_AS_TEXT_EVENT, { bubbles: true }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        cancelable: true,
        clipboardData: screenshotClipboard("Copied from Word"),
      }),
    );
  });

  expect(serializeEditorDoc(editor.state.doc).value).toBe("Copied from Word");
  expect(useComposerDraftStore.getState().getComposerDraft(app.draftId)?.images).toHaveLength(0);
  expect(countPreparingComposerImages(composerTargetKey(app.draftId))).toBe(0);
});
