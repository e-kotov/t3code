import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  addAssistantCitationSelectionListener,
  emitAssistantCitationSelection,
} from "./assistantCitationSelection";

const source = {
  environmentId: "environment-1",
  threadId: "thread-1",
  messageId: "message-1",
};

describe("assistant citation selection", () => {
  it("preserves the selected text and source when native selection bounds are reversed", () => {
    const listener = vi.fn();
    const subscription = addAssistantCitationSelectionListener(listener);
    try {
      emitAssistantCitationSelection(source, "quoted text", { start: 18, end: 7 });

      expect(listener).toHaveBeenCalledExactlyOnceWith({
        ...source,
        text: "quoted text",
        start: 7,
        end: 18,
        prefix: "",
        suffix: "",
      });
    } finally {
      subscription.remove();
    }
  });

  it("does not offer blank or oversized selections to a quote sheet", () => {
    const listener = vi.fn();
    const subscription = addAssistantCitationSelectionListener(listener);
    try {
      expect(emitAssistantCitationSelection(source, " \n\t", { start: 0, end: 3 })).toBe(
        "Select some assistant text to quote.",
      );
      expect(
        emitAssistantCitationSelection(source, "a".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1), {
          start: 0,
          end: ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1,
        }),
      ).toContain("8,000");

      expect(listener).not.toHaveBeenCalled();
    } finally {
      subscription.remove();
    }
  });

  it("stops delivering selections to an unmounted subscriber", () => {
    const listener = vi.fn();
    const subscription = addAssistantCitationSelectionListener(listener);
    subscription.remove();

    emitAssistantCitationSelection(source, "quoted text", { start: 0, end: 11 });

    expect(listener).not.toHaveBeenCalled();
  });
});
