import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { registerActiveCite } from "./forkCitationInputRouting";
import { useChatShortcuts } from "./useChatShortcuts";

vi.mock(import("~/hooks/useSettings"), () => ({
  getClientSettings: () => ({ ...DEFAULT_CLIENT_SETTINGS, typingWithSelection: "cite" }),
}));

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

function Chat(props: { composerKeys: string[]; stops?: string[] }) {
  useChatShortcuts({
    enabled: true,
    keybindings: [
      {
        command: "thread.stop",
        shortcut: {
          key: "a",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: false,
        },
      },
    ],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    // Type-to-focus only calls insertTextAtEnd, so the stand-in composer implements just that.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: { "thread.stop": () => void props.stops?.push("stop") },
    fallback: () => undefined,
  });
  return null;
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

it("does not resolve a shortcut after citation input consumes its key", async () => {
  const composerKeys: string[] = [];
  const stops: string[] = [];
  await using _screen = await render(<Chat composerKeys={composerKeys} stops={stops} />, options);
  using _toolbar = {
    [Symbol.dispose]: registerActiveCite(() => {
      return { source: document.body, viewport: document.body, range: document.createRange() };
    }),
  };
  const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(stops).toEqual([]);
  expect(composerKeys).toEqual([]);
});
