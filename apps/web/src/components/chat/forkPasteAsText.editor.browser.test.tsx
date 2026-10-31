import {
  ComposerContextId,
  EnvironmentId,
  type ComposerContextClipboardFragment,
} from "@t3tools/contracts";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import type { Editor } from "@tiptap/core";
import { createRef, useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { serializeEditorDoc } from "~/composer-rich-text-doc";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorProps,
} from "../ComposerPromptEditorTiptap";
import { markTextOnlyPasteEvent } from "./forkPasteAsText";

function TestComposer({
  importContextFragment,
}: {
  importContextFragment: NonNullable<ComposerPromptEditorProps["importContextFragment"]>;
}) {
  const [prompt, setPrompt] = useState({ value: "", cursor: 0 });
  return (
    <ComposerPromptEditorTiptap
      editorRef={createRef<ComposerPromptEditorHandle>()}
      value={prompt.value}
      cursor={prompt.cursor}
      contextRecords={new Map()}
      importContextFragment={importContextFragment}
      skills={[]}
      disabled={false}
      placeholder=""
      onChange={(value, cursor) => setPrompt({ value, cursor })}
      onPaste={(event) => markTextOnlyPasteEvent(event.nativeEvent)}
    />
  );
}

function editorIn(container: HTMLElement): Editor {
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  return element.editor;
}

it("imports copied T3 context through the editor paste handler with image clipboard data", async () => {
  const fragment = encodeComposerContextFragment({
    version: 1,
    source: { environmentId: EnvironmentId.make("env") },
    records: [
      {
        version: 1,
        contextId: ComposerContextId.make("ctx_old"),
        kind: "terminal",
        label: "Terminal 1",
        terminalId: "term-1",
        terminalLabel: "Terminal 1",
        lineStart: 1,
        lineEnd: 1,
        text: "output",
      },
    ],
  });
  if (!fragment) throw new Error("Context clipboard fragment could not be encoded");
  const importContextFragment = vi.fn(
    (
      _fragment: ComposerContextClipboardFragment,
    ): ReadonlyMap<ComposerContextId, ComposerContextId> =>
      new Map([[ComposerContextId.make("ctx_old"), ComposerContextId.make("ctx_new")]]),
  );
  await using screen = await render(
    <TestComposer importContextFragment={importContextFragment} />,
    { router: false },
  );
  const editor = editorIn(screen.container);
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", "[Terminal 1](t3-context://v1/terminal/ctx_old)");
  clipboardData.setData(COMPOSER_CONTEXT_CLIPBOARD_MIME, fragment);
  clipboardData.items.add(new File(["image bytes"], "screenshot.png", { type: "image/png" }));

  await act(async () => {
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  });

  expect(importContextFragment).toHaveBeenCalledOnce();
  expect(serializeEditorDoc(editor.state.doc).value).toContain("ctx_new");
});
