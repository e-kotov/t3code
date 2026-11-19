import { createAssistantTextSelector } from "@t3tools/shared/assistantCitations";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ReviewCommentContextSchema } from "~/reviewCommentContext";
import {
  buildEditableReviewComment,
  buildSublineFileReviewComment,
  formatQuotedRangeLabel,
  inferMarkdownSourceLineRange,
  matchesFileReviewComment,
} from "./forkFileSublineComments";

describe("forkFileSublineComments", () => {
  it("formats quoted range labels with and without line numbers", () => {
    expect(formatQuotedRangeLabel({ quoteText: "  retry\n  limit  " })).toBe('"retry limit"');
    expect(
      formatQuotedRangeLabel({
        quoteText: "retry limit",
        startLine: 12,
        endLine: 12,
      }),
    ).toBe('L12 · "retry limit"');
    expect(
      formatQuotedRangeLabel({
        quoteText: "a phrase that is quite a bit longer than thirty two characters",
        startLine: 4,
        endLine: 5,
      }),
    ).toBe('L4 to L5 · "a phrase that is quite a bit lo…"');
  });

  it("infers unique source line ranges from rendered Markdown quotes and skips ambiguous ones", () => {
    const markdown = [
      "# Guide",
      "",
      "Please **clarify the retry limit** before shipping.",
      "Repeated phrase appears here.",
      "Repeated phrase appears here too.",
    ].join("\n");

    const renderedText = "Guide\nPlease clarify the retry limit before shipping.";
    const needle = "clarify the retry limit";
    const start = renderedText.indexOf(needle);
    const quote = createAssistantTextSelector(renderedText, start, start + needle.length)!;
    expect(inferMarkdownSourceLineRange(markdown, quote)).toEqual({ startLine: 3, endLine: 3 });

    const repeated = "Repeated phrase";
    const repStart = markdown.indexOf(repeated);
    const ambiguousQuote = createAssistantTextSelector(
      markdown,
      repStart,
      repStart + repeated.length,
    )!;
    expect(
      inferMarkdownSourceLineRange("Repeated phrase\nRepeated phrase", {
        ...ambiguousQuote,
        start: 0,
        end: 0,
        prefix: "",
        suffix: "",
      }),
    ).toBeNull();
  });

  it("builds valid schema-compliant ReviewCommentContext records and validates staleness", () => {
    const contents = "const first = 1;\nconst retryCount = 3;\nconst last = 4;\n";
    const phrase = "retryCount = 3";
    const start = contents.indexOf(phrase);
    const quote = createAssistantTextSelector(contents, start, start + phrase.length)!;

    const sublineComment = buildSublineFileReviewComment({
      id: "comment-subline-1",
      filePath: "src/config.ts",
      sectionKind: "file",
      text: "Make this configurable.",
      quote,
      contents,
      startLine: 2,
      endLine: 2,
    });

    expect(Schema.is(ReviewCommentContextSchema)(sublineComment)).toBe(true);
    expect(sublineComment).toMatchObject({
      sectionId: "file:src/config.ts",
      startIndex: 1,
      endIndex: 1,
      rangeLabel: 'L2 · "retryCount = 3"',
      diff: "retryCount = 3",
      text: "Make this configurable.",
      quote,
    });
    expect(matchesFileReviewComment(sublineComment, contents)).toBe(true);
    expect(
      matchesFileReviewComment(sublineComment, "const first = 1;\nconst other = 9;\nconst last = 4;\n"),
    ).toBe(false);

    const lineComment = buildEditableReviewComment({
      id: "comment-line-1",
      filePath: "src/config.ts",
      startLine: 2,
      endLine: 2,
      text: "Whole line comment.",
      contents,
    });
    expect(lineComment.quote).toBeUndefined();
    expect(lineComment.diff).toBe("const retryCount = 3;");
    expect(matchesFileReviewComment(lineComment, contents)).toBe(true);
  });
});
