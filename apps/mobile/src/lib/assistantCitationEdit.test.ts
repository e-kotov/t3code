import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  EnvironmentId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
} from "@t3tools/contracts";
import {
  collectAssistantCitations,
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";
import {
  assistantCitationFromChip,
  captureAssistantCitationEdit,
  prepareAssistantCitationEdit,
  prepareAssistantCitationRemoval,
} from "./assistantCitationEdit";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("source-environment"),
  threadId: ThreadId.make("source-thread"),
  messageId: MessageId.make("message-1"),
  text: "Keep authentication on the server.",
  comment: "Old comment",
  start: 7,
  end: 41,
  prefix: "Before ",
  suffix: " After",
};
const owner = {
  environmentId: EnvironmentId.make("draft-environment"),
  threadId: ThreadId.make("draft-thread"),
  draftKey: "draft-1",
};

function fixture(quote = citation, prefix = "before 💡 ", suffix = " after") {
  const source = serializeAssistantCitation(quote);
  const draft = `${prefix}${source}${suffix}`;
  const selection = { source, start: prefix.length, end: prefix.length + source.length };
  const pending = captureAssistantCitationEdit({ ...owner, draft, selection });
  if (pending === null) throw new Error("Expected a captured citation");
  return { ...owner, draft, pending, canEdit: true, comment: "New comment" };
}

describe("editing a citation comment", () => {
  it("updates the comment in place and preserves the quote, source and surrounding text", () => {
    const input = fixture();
    const marker = serializeAssistantCitation(
      withAssistantCitationComment(citation, input.comment),
    );
    const result = prepareAssistantCitationEdit(input);
    expect(result).toEqual({
      value: `before 💡 ${marker} after`,
      cursor: "before 💡 ".length + marker.length,
    });
    if ("error" in result) throw new Error(result.error);
    expect(collectAssistantCitations(result.value).map((quote) => quote.citation)).toEqual([
      { ...citation, comment: "New comment" },
    ]);
  });

  it("allows a pasted citation from another thread to be edited in the current draft", () => {
    const input = fixture();
    expect(input.pending.citation.environmentId).not.toBe(input.environmentId);
    expect(input.pending.citation.threadId).not.toBe(input.threadId);
    expect(prepareAssistantCitationEdit(input)).toHaveProperty("value");
  });

  it("can remove a comment without removing the citation", () => {
    const result = prepareAssistantCitationEdit({ ...fixture(), comment: " \n " });
    if ("error" in result) throw new Error(result.error);
    const quote = collectAssistantCitations(result.value)[0];
    if (!quote) throw new Error("Expected the citation to remain");
    const updated = quote.citation;
    expect(updated).toEqual(withAssistantCitationComment(citation, ""));
    expect(updated).not.toHaveProperty("comment");
  });

  it("updates only the tapped copy when two identical quote chips exist", () => {
    const original = serializeAssistantCitation(citation);
    const input = fixture(citation, `${original} between `, " end");
    const result = prepareAssistantCitationEdit(input);
    if ("error" in result) throw new Error(result.error);
    expect(collectAssistantCitations(result.value).map((quote) => quote.citation.comment)).toEqual([
      "Old comment",
      "New comment",
    ]);
    expect(result.value.startsWith(`${original} between `)).toBe(true);
  });

  it.each([
    { canEdit: false },
    { draftKey: null },
    { draftKey: "another-draft" },
    { environmentId: EnvironmentId.make("another-environment") },
    { threadId: ThreadId.make("another-thread") },
  ])("refuses a locked or replaced composer: %j", (change) => {
    expect(prepareAssistantCitationEdit({ ...fixture(), ...change })).toHaveProperty("error");
  });

  it.each(["prefix", "suffix", "deleted", "duplicate"])(
    "refuses to overwrite a draft changed in the background: %s",
    (change) => {
      const input = fixture();
      const draft =
        change === "prefix"
          ? `new ${input.draft}`
          : change === "suffix"
            ? `${input.draft} new`
            : change === "deleted"
              ? ""
              : input.draft + input.pending.selection.source;
      expect(prepareAssistantCitationEdit({ ...input, draft })).toEqual({
        error: "The draft changed. Close this sheet and tap the quote again.",
      });
    },
  );

  it("checks the trimmed comment limit", () => {
    expect(
      prepareAssistantCitationEdit({
        ...fixture(),
        comment: "x".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH + 1),
      }),
    ).toHaveProperty("error");
    expect(
      prepareAssistantCitationEdit({
        ...fixture(),
        comment: `  ${"x".repeat(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)}  `,
      }),
    ).toHaveProperty("value");
  });

  it("rejects an edit whose encoded marker exceeds the prompt cap", () => {
    const quote = { ...citation, text: "漢".repeat(8000), end: 8007, comment: "" };
    expect(
      prepareAssistantCitationEdit({ ...fixture(quote), comment: "漢".repeat(8000) }),
    ).toHaveProperty("error");
  });

  it("checks expanded length even when the raw edited draft is below the cap", () => {
    const quote = { ...citation, text: "<>".repeat(4000), end: 8007, comment: "" };
    const comment = "<>".repeat(4000);
    const marker = serializeAssistantCitation(withAssistantCitationComment(quote, comment));
    const prefix = "x".repeat(
      PROVIDER_SEND_TURN_MAX_INPUT_CHARS - expandAssistantCitationsForProvider(marker).length + 1,
    );
    expect(prefix.length + marker.length).toBeLessThan(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    expect(prepareAssistantCitationEdit({ ...fixture(quote, prefix, ""), comment })).toHaveProperty(
      "error",
    );
  });
});

describe("capturing the tapped citation", () => {
  it("recognizes the complete chip marker instead of parsing it as a bare href", () => {
    const marker = serializeAssistantCitation(citation);
    expect(assistantCitationFromChip(marker)).toEqual(citation);
    expect(assistantCitationFromChip(`before ${marker}`)).toBeNull();
    expect(assistantCitationFromChip(`${marker} after`)).toBeNull();
    expect(assistantCitationFromChip("@src/file.ts")).toBeNull();
  });

  it.each([
    { start: -1 },
    { start: 0.5 },
    { start: 0 },
    { end: 0 },
    { end: -6 },
    { end: 999999 },
    { source: "not a citation" },
  ])("rejects invalid or stale native ranges: %j", (change) => {
    const input = fixture();
    expect(
      captureAssistantCitationEdit({
        ...owner,
        draft: input.draft,
        selection: { ...input.pending.selection, ...change },
      }),
    ).toBeNull();
  });
});

describe("removing a citation", () => {
  it("removes only the tapped chip and preserves all surrounding draft text", () => {
    const marker = serializeAssistantCitation(citation);
    const input = fixture(citation, `${marker} before 💡 `, " after");
    expect(prepareAssistantCitationRemoval(input)).toEqual({
      value: `${marker} before 💡  after`,
      cursor: `${marker} before 💡 `.length,
    });
  });

  it("can empty a draft that contains only the quote", () => {
    expect(prepareAssistantCitationRemoval(fixture(citation, "", ""))).toEqual({
      value: "",
      cursor: 0,
    });
  });

  it.each([
    { canEdit: false },
    { draftKey: null },
    { draftKey: "another-draft" },
    { environmentId: EnvironmentId.make("another-environment") },
    { threadId: ThreadId.make("another-thread") },
    { draft: "new draft" },
  ])("refuses to remove from a locked, replaced or changed draft: %j", (change) => {
    expect(prepareAssistantCitationRemoval({ ...fixture(), ...change })).toHaveProperty("error");
  });

  it("allows removing a quote from an already oversized draft", () => {
    const prefix = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1);
    const input = fixture(citation, prefix, "");
    expect(prepareAssistantCitationRemoval(input)).toEqual({
      value: prefix,
      cursor: prefix.length,
    });
  });
});
