import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "./composerInlineTokens.ts";
import { serializeAssistantCitation } from "./assistantCitations.ts";

describe("assistant citation composer integration", () => {
  it("keeps assistant citations as atomic composer tokens with their quote metadata", () => {
    const citation = {
      version: 1 as const,
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("message-1"),
      text: "Keep the selection attached to its source.",
      comment: "Explain why this matters",
      start: 8,
      end: 43,
      prefix: "Please ",
      suffix: " Next sentence.",
    };
    const marker = serializeAssistantCitation(citation);
    const draft = `Review this ${marker} please`;
    const [token] = collectComposerInlineTokens(draft);

    expect(token).toMatchObject({
      type: "assistantCitation",
      value: citation.text,
      source: marker,
      citation,
    });
    expect(draft.slice(token!.start, token!.end)).toBe(marker);
  });
});
