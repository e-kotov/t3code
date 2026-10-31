import { describe, expect, it, vi } from "vite-plus/test";

import { pasteAsText } from "./forkPasteAsText";

describe("text-only composer paste", () => {
  it("inserts clipboard plain text and suppresses the image paste", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const insertText = vi.fn();

    expect(pasteAsText(true, "Copied from Word", event, insertText)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(insertText).toHaveBeenCalledWith("Copied from Word");
  });

  it("consumes a text-only paste with no plain text without falling back to an image", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const insertText = vi.fn();

    expect(pasteAsText(true, "", event, insertText)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(insertText).not.toHaveBeenCalled();
  });

  it("leaves regular paste handling unchanged", () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const insertText = vi.fn();

    expect(pasteAsText(false, "Copied text", event, insertText)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(insertText).not.toHaveBeenCalled();
  });
});
