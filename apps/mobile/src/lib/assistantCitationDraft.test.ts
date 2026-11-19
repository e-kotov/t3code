import {
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import {
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { expect, it, vi } from "vite-plus/test";
import {
  assistantCitationPromptLengthError,
  citationCaretAfterSelection,
  rejectOversizedAssistantCitationPrompt,
} from "./assistantCitationDraft";

it("inserts after a selected draft range without discarding the selected text", () => {
  const text = "keep this";
  const { start, end } = citationCaretAfterSelection({ text, start: 0, end: 4 });
  expect(text.slice(0, start) + " [quote]" + text.slice(end)).toBe("keep [quote] this");
  expect(citationCaretAfterSelection({ text, start: 4, end: 0 })).toEqual({
    text,
    start: 4,
    end: 4,
  });
});

it("blocks oversized encoded and expanded prompts before the composer sends", () => {
  const alert = vi.fn();
  expect(rejectOversizedAssistantCitationPrompt("ordinary draft", alert)).toBe(false);
  expect(alert).not.toHaveBeenCalled();
  expect(
    rejectOversizedAssistantCitationPrompt(
      "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1),
      alert,
    ),
  ).toBe(true);
  expect(alert).toHaveBeenCalledExactlyOnceWith("Prompt too long", expect.any(String));
  const marker = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    text: "x",
    start: 0,
    end: 1,
    prefix: "",
    suffix: "",
  });
  const expandedLength = expandAssistantCitationsForProvider(marker).length;
  expect(expandedLength).toBeGreaterThan(marker.length);
  const exact = `${"x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - expandedLength - 1)} ${marker}`;
  expect(expandAssistantCitationsForProvider(exact)).toHaveLength(
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  );
  expect(assistantCitationPromptLengthError(exact)).toBeNull();
  expect(assistantCitationPromptLengthError(`x${exact}`)).not.toBeNull();
  const encoded = "a".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - marker.length) + marker;
  expect(encoded).toHaveLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
  expect(assistantCitationPromptLengthError(encoded)).not.toBeNull();
});
