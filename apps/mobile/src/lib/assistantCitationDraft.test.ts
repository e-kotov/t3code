import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import {
  collectAssistantCitations,
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";
import { prepareAssistantCitationInsertion } from "./assistantCitationDraft";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  text: "quoted text",
  start: 0,
  end: 11,
  prefix: "",
  suffix: "",
};

const input = {
  pending: { citation, draftKey: "draft-1", insertion: { text: "", start: 0, end: 0 } },
  environmentId: citation.environmentId,
  threadId: citation.threadId,
  draftKey: "draft-1",
  canInsert: true,
  draft: "",
  comment: "",
};

describe("assistant citation draft insertion", () => {
  it("refuses to write while the composer is hidden or locked", () => {
    expect(prepareAssistantCitationInsertion({ ...input, canInsert: false })).toHaveProperty(
      "error",
    );
  });

  it.each([
    { draftKey: null },
    { draftKey: "queued-edit-2" },
    { environmentId: EnvironmentId.make("environment-2") },
    { threadId: ThreadId.make("thread-2") },
  ])("does not move a pending quote to another composer: %j", (target) => {
    expect(prepareAssistantCitationInsertion({ ...input, ...target })).toHaveProperty("error");
  });

  it("inserts at the captured caret with text boundaries", () => {
    const draft = "beforeafter";
    const result = prepareAssistantCitationInsertion({
      ...input,
      draft,
      pending: { ...input.pending, insertion: { text: draft, start: 6, end: 6 } },
    });
    const marker = serializeAssistantCitation(citation);
    expect(result).toEqual({ value: `before ${marker} after`, cursor: 8 + marker.length });
  });

  it("preserves a draft changed while the comment sheet was open", () => {
    const result = prepareAssistantCitationInsertion({
      ...input,
      draft: "new draft",
      pending: { ...input.pending, insertion: { text: "old draft", start: 0, end: 9 } },
    });
    expect(result).toEqual({
      value: `new draft ${serializeAssistantCitation(citation)}`,
      cursor: 10 + serializeAssistantCitation(citation).length,
    });
  });

  it("rejects an encoded CJK quote and comment that exceed the prompt cap", () => {
    expect(
      prepareAssistantCitationInsertion({
        ...input,
        pending: {
          ...input.pending,
          citation: {
            ...citation,
            text: "語".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
            end: ASSISTANT_CITATION_MAX_TEXT_LENGTH,
          },
        },
        comment: "語".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH),
      }),
    ).toHaveProperty("error");
  });

  it("rejects a quote that would overflow an existing draft", () => {
    expect(
      prepareAssistantCitationInsertion({
        ...input,
        draft: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
      }),
    ).toHaveProperty("error");
  });

  it("allows the exact expanded limit and refuses one more character", () => {
    const marker = serializeAssistantCitation(citation);
    const expandedLength = expandAssistantCitationsForProvider(marker).length;
    expect(expandedLength).toBeGreaterThan(marker.length);
    const draft = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - expandedLength - 1);
    const accepted = prepareAssistantCitationInsertion({ ...input, draft });
    if ("error" in accepted) throw new Error(accepted.error);
    expect(accepted.value.length).toBeLessThan(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    expect(expandAssistantCitationsForProvider(accepted.value).length).toBe(
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    );
    expect(prepareAssistantCitationInsertion({ ...input, draft: `${draft}x` })).toHaveProperty(
      "error",
    );
  });

  it("checks the trimmed comment without silently truncating it", () => {
    const comment = "a".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH);
    const accepted = prepareAssistantCitationInsertion({ ...input, comment: `   ${comment}   ` });
    if ("error" in accepted) throw new Error(accepted.error);
    expect(collectAssistantCitations(accepted.value)[0]?.citation.comment).toBe(comment);
    expect(prepareAssistantCitationInsertion({ ...input, comment: `${comment}a` })).toHaveProperty(
      "error",
    );
  });
});
