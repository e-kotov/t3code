import { ComposerContextRecord, type ReviewCommentContextRecord } from "@t3tools/contracts";
import { createAssistantTextSelector } from "@t3tools/shared/assistantCitations";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { reviewCommentContextRecord, reviewCommentFromRecord } from "~/lib/composerContextRecords";
import {
  buildFileReviewComment,
  type ReviewCommentContext,
  ReviewCommentContextSchema,
} from "~/reviewCommentContext";
import {
  buildSublineFileReviewComment,
  fileReviewCommentsFor,
  formatQuotedRangeLabel,
  inferMarkdownSourceLineRange,
  renderedMarkdownCommentsFor,
  resolveFileReviewComment,
} from "./forkFileSublineComments";

const isReviewCommentContext = Schema.is(ReviewCommentContextSchema);
const decodeRecord = Schema.decodeUnknownSync(ComposerContextRecord);

// Stash and context import persist records as JSON and decode them with the wire schema.
function throughRecord(comment: ReviewCommentContext): ReviewCommentContext {
  const record = decodeRecord(JSON.parse(JSON.stringify(reviewCommentContextRecord(comment))));
  return reviewCommentFromRecord(record as ReviewCommentContextRecord);
}

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
    ).toBe('L4 to L5 · "a phrase that is quite a bit lon…"');
  });

  it("infers unique Markdown source line ranges and skips ambiguous quotes", () => {
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

    expect(isReviewCommentContext(sublineComment)).toBe(true);
    expect(sublineComment).toMatchObject({
      sectionId: "file:src/config.ts",
      startIndex: 1,
      endIndex: 1,
      rangeLabel: 'L2 · "retryCount = 3"',
      diff: "retryCount = 3",
      text: "Make this configurable.",
      quote,
    });
    expect(resolveFileReviewComment(sublineComment, contents)).toBe(sublineComment);
    const edited = "const first = 1;\nconst other = 9;\nconst last = 4;\n";
    expect(resolveFileReviewComment(sublineComment, edited)).toBeNull();

    const restored = throughRecord(sublineComment);
    expect(restored.quote).toBeUndefined();
    expect(fileReviewCommentsFor([restored], "src/config.ts", contents)).toEqual([
      { ...restored, quote },
    ]);
    expect(resolveFileReviewComment(restored, edited)).toBeNull();

    const lineComment = buildFileReviewComment({
      id: "comment-line-1",
      filePath: "src/config.ts",
      startLine: 2,
      endLine: 2,
      text: "Whole line comment.",
      contents,
    });
    expect(lineComment.diff).toBe("const retryCount = 3;");
    const restoredLine = throughRecord(lineComment);
    expect(resolveFileReviewComment(restoredLine, contents)).toEqual(restoredLine);
    const extended = contents.replace("retryCount = 3;", "retryCount = 3; // tuned");
    expect(resolveFileReviewComment(restoredLine, extended)).toBeNull();

    const renderedQuote = createAssistantTextSelector("Please retry later.", 7, 12)!;
    const renderedComment = throughRecord(
      buildSublineFileReviewComment({
        id: "comment-rendered-1",
        filePath: "docs/guide.md",
        sectionKind: "file-rendered",
        text: "Say when.",
        quote: renderedQuote,
        contents: "Please **retry** later.\n",
      }),
    );
    expect(renderedMarkdownCommentsFor([renderedComment], "docs/guide.md")[0]?.quote?.text).toBe(
      "retry",
    );
  });
});
