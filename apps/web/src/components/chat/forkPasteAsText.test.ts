import { describe, expect, it } from "vite-plus/test";

import {
  isTextOnlyPasteEvent,
  markTextOnlyPasteEvent,
  shouldPreferClipboardTextForPaste,
} from "./forkPasteAsText";

describe("text-only composer paste", () => {
  it("prefers plain text over a copied image only for Paste as Text", () => {
    expect(
      shouldPreferClipboardTextForPaste({
        bypassAutoAttachment: true,
        plainText: "Copied from Word",
        files: [{ name: "screenshot.png", type: "image/png" }],
        hasFolders: false,
      }),
    ).toBe(true);
    expect(
      shouldPreferClipboardTextForPaste({
        bypassAutoAttachment: false,
        plainText: "Copied from Word",
        files: [{ name: "screenshot.png", type: "image/png" }],
        hasFolders: false,
      }),
    ).toBe(false);
  });

  it("keeps image-only, file, and folder pastes on their attachment paths", () => {
    const files = [{ name: "screenshot.png", type: "image/png" }];
    expect(
      shouldPreferClipboardTextForPaste({
        bypassAutoAttachment: true,
        plainText: "",
        files,
        hasFolders: false,
      }),
    ).toBe(false);
    expect(
      shouldPreferClipboardTextForPaste({
        bypassAutoAttachment: true,
        plainText: "/tmp/report.pdf",
        files: [{ name: "report.pdf", type: "application/pdf" }],
        hasFolders: false,
      }),
    ).toBe(false);
    expect(
      shouldPreferClipboardTextForPaste({
        bypassAutoAttachment: true,
        plainText: "folder",
        files,
        hasFolders: true,
      }),
    ).toBe(false);
  });

  it("marks only the event that the editor should handle as a text-only paste", () => {
    const event = new Event("paste");
    expect(isTextOnlyPasteEvent(event)).toBe(false);
    markTextOnlyPasteEvent(event);
    expect(isTextOnlyPasteEvent(event)).toBe(true);
  });
});
