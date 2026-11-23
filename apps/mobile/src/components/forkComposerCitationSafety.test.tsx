import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { ReactNode } from "react";

const marker = serializeAssistantCitation({
  version: 1,
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
  text: "quoted passage",
  start: 0,
  end: 14,
  prefix: "",
  suffix: "",
  comment: "old comment",
});

vi.mock("../native/T3ComposerEditor", () => ({
  ComposerEditor: ({
    onContextPress,
  }: {
    onContextPress?: (selection: { source: string; start: number; end: number }) => void;
  }) => (
    <button
      id="select-quote"
      onClick={() =>
        onContextPress?.({
          source: marker,
          start: 0,
          end: marker.length,
        })
      }
    />
  ),
}));

vi.mock("./AssistantCitationSheet", () => ({
  AssistantCitationSheet: ({
    onCommentChange,
    onRemove,
  }: {
    onCommentChange?: (comment: string) => void;
    onRemove?: () => void;
  }) => (
    <section id="quote-sheet">
      {onCommentChange ? (
        <button id="save-quote" onClick={() => onCommentChange("new comment")} />
      ) : null}
      {onRemove ? <button id="remove-quote" onClick={onRemove} /> : null}
    </section>
  ),
}));

vi.mock("expo-file-system", () => ({
  Directory: class {
    create() {}
  },
  File: class {
    exists = false;
    write() {}
  },
  Paths: { document: { uri: "file:///documents" } },
}));
vi.mock("./ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("./ui/AppText", () => ({ AppText: ({ children }: { children?: ReactNode }) => children }));
vi.mock("./ComposerContextSheet", () => ({ ComposerContextSheet: () => null }));
vi.mock("../features/threads/useOpenLinkedThread", () => ({ useOpenLinkedThread: () => vi.fn() }));
vi.mock("../features/threads/useOpenThreadLink", () => ({ useOpenThreadLink: () => vi.fn() }));
vi.mock("../state/peerLinks", () => ({ useLinkedEnvironments: () => [] }));
vi.mock("../state/model-mentions", () => ({ useModelMentions: () => [] }));
vi.mock("../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return { mobilePreferencesAtom: Atom.make({ _tag: "Initial" }) };
});
vi.mock("../lib/composerContextClipboard", () => ({ importComposerContextClipboard: vi.fn() }));
vi.mock("../lib/useUniwindTheme", () => ({ useUniwindTheme: () => ({}) }));
vi.mock("../lib/nativeComposerTheme", () => ({ createNativeComposerTheme: () => ({}) }));
vi.mock("../lib/contextChipIconSource", () => ({ contextChipIconUri: () => "" }));
vi.mock("../features/settings/appearance/useScaledTextRole", () => ({
  useComposerTextRole: () => ({ fontSize: 16, lineHeight: 22 }),
}));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid", randomHex: () => "0000" }));
vi.mock("../state/assets", () => ({ assetEnvironment: {} }));
vi.mock("../state/attachments", () => ({ attachmentEnvironment: {} }));
vi.mock("../state/session", () => ({ environmentSession: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentRpcCommand: () => Symbol("rpc-command"),
  settlePromise: vi.fn(),
  squashAtomCommandFailure: vi.fn(),
}));

import { appAtomRegistry } from "../state/atom-registry";
import { setComposerContextImporting, setComposerDraftText } from "../state/use-composer-drafts";
import { ComposerEditor } from "./ComposerEditor";

function setup() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const onChangeText = vi.fn();
  const render = (draftKey: string, value = marker) =>
    act(() => {
      setComposerDraftText(draftKey, value);
      root.render(
        <RegistryContext.Provider value={appAtomRegistry}>
          <ComposerEditor
            draftKey={draftKey}
            value={value}
            onChangeText={(value) => onChangeText(draftKey, value)}
          />
        </RegistryContext.Provider>,
      );
    });
  const button = (id: string) => {
    const element = host.querySelector<HTMLButtonElement>(`#${id}`);
    if (!element) throw new Error(`Missing #${id}`);
    return element;
  };
  return {
    host,
    render,
    button,
    onChangeText,
    [Symbol.asyncDispose]: async () => act(() => root.unmount()),
  };
}

it("closes a quote editor when a new draft has the same marker at the same offset", async () => {
  await using screen = setup();
  await screen.render("citation-draft:original");
  await act(() => screen.button("select-quote").click());
  expect(screen.host.querySelector("#save-quote")).not.toBeNull();

  await screen.render("citation-draft:replacement");
  await act(() => screen.host.querySelector<HTMLButtonElement>("#save-quote")?.click());
  expect(screen.onChangeText).not.toHaveBeenCalled();
  expect(screen.host.querySelector("#quote-sheet")).toBeNull();

  await screen.render("citation-draft:original");
  expect(screen.host.querySelector("#quote-sheet")).toBeNull();
  await act(() => screen.button("select-quote").click());
  await act(() => screen.button("save-quote").click());
  expect(screen.onChangeText).toHaveBeenCalledOnce();
  expect(screen.onChangeText.mock.calls[0]?.[0]).toBe("citation-draft:original");
  expect(screen.onChangeText.mock.calls[0]?.[1]).toContain("comment=new+comment");
});

it("rejects save and removal if an import starts before the open sheet rerenders", async () => {
  const draftKey = "citation-draft:importing";
  await using screen = setup();
  await screen.render(draftKey);
  await act(() => screen.button("select-quote").click());
  const save = screen.button("save-quote");
  const remove = screen.button("remove-quote");

  try {
    await act(() => {
      setComposerContextImporting(draftKey, true);
      save.click();
      remove.click();
    });
    expect(screen.onChangeText).not.toHaveBeenCalled();
    expect(screen.host.querySelector("#save-quote")).toBeNull();
    expect(screen.host.querySelector("#remove-quote")).toBeNull();
  } finally {
    await act(() => setComposerContextImporting(draftKey, false));
  }
});

it("rejects save and removal after a rerender preserves the marker in a revised draft", async () => {
  const draftKey = "citation-draft:rerendered";
  await using screen = setup();
  await screen.render(draftKey);
  await act(() => screen.button("select-quote").click());
  await screen.render(draftKey, `${marker} revised prose`);
  await act(() => {
    screen.button("save-quote").click();
    screen.button("remove-quote").click();
  });
  expect(screen.onChangeText).not.toHaveBeenCalled();
});

it("rejects save and removal when the live draft changes before rerender", async () => {
  const draftKey = "citation-draft:live-change";
  await using screen = setup();
  await screen.render(draftKey);
  await act(() => screen.button("select-quote").click());
  await act(() => {
    setComposerDraftText(draftKey, `${marker} revised prose`);
    screen.button("save-quote").click();
    screen.button("remove-quote").click();
  });
  expect(screen.onChangeText).not.toHaveBeenCalled();
});

it("removes a quote from an unchanged draft", async () => {
  const draftKey = "citation-draft:remove";
  await using screen = setup();
  await screen.render(draftKey);
  await act(() => screen.button("select-quote").click());
  await act(() => screen.button("remove-quote").click());
  expect(screen.onChangeText).toHaveBeenCalledExactlyOnceWith(draftKey, "");
});
