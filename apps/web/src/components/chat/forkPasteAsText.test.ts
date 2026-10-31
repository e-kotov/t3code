import { describe, expect, it } from "vite-plus/test";

import { isTextOnlyPasteEvent, shouldPreferClipboardTextForPaste } from "./forkPasteAsText";

describe("text-only composer paste", () => {
  it("only bypasses image attachment handling when Paste as Text is armed", () => {
    const event = new Event("paste");
    const input = {
      event,
      plainText: "Copied from Word",
      files: [new File(["image"], "screenshot.png", { type: "image/png" })],
      folders: [],
    };

    expect(
      shouldPreferClipboardTextForPaste({
        ...input,
        bypassAutoAttachment: false,
      }),
    ).toBe(false);
    expect(isTextOnlyPasteEvent(event)).toBe(false);
    expect(
      shouldPreferClipboardTextForPaste({
        ...input,
        bypassAutoAttachment: true,
        plainText: "",
      }),
    ).toBe(false);
    expect(
      shouldPreferClipboardTextForPaste({
        ...input,
        bypassAutoAttachment: true,
      }),
    ).toBe(true);
    expect(isTextOnlyPasteEvent(event)).toBe(true);
  });
});
