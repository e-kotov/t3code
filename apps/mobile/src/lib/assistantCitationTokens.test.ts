import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { markdownMathRanges } from "@t3tools/shared/markdownMath";
import { describe, expect, it } from "vite-plus/test";
import { composerContextEditorTokens } from "./composerContext";

const citation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
  text: "quoted text",
  comment: "Explain why this matters",
  start: 0,
  end: 11,
  prefix: "",
  suffix: "",
};

describe("mobile citation tokens", () => {
  it("keeps a quote atomic without an overlapping file mention", () => {
    const marker = serializeAssistantCitation(citation);
    const draft = `ask @${marker} now`;
    const tokens = composerContextEditorTokens(
      draft,
      collectComposerInlineTokens(draft),
      new Map(),
    );
    expect(tokens).toEqual([
      {
        type: "citation",
        value: citation.comment,
        source: marker,
        start: 5,
        end: 5 + marker.length,
        citation,
      },
    ]);
  });

  it("keeps a citation inside a display formula as text", () => {
    const marker = serializeAssistantCitation(citation);
    const draft = `Quote ${marker}.\n\n$$\n${marker}\n$$`;
    const tokens = composerContextEditorTokens(
      draft,
      collectComposerInlineTokens(draft, { findMath: markdownMathRanges }),
      new Map(),
    );
    expect(tokens.map((token) => [token.type, token.start])).toEqual([["citation", 6]]);
  });

  it("does not add mobile-only citation tokens to the shared parser", () => {
    expect(collectComposerInlineTokens(serializeAssistantCitation(citation))).toEqual([]);
  });
});
