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
  clearShadowSourceSublineHighlights,
  fileReviewCommentsFor,
  formatQuotedRangeLabel,
  inferMarkdownSourceLineRange,
  quoteSubmittedFileComment,
  remapQuotedFileComment,
  renderedMarkdownCommentsFor,
  resolveFileReviewComment,
  type SourceSelection,
  sourceSublineAnchors,
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

    // Markup splits the rendered word, and an earlier URL holds the same raw text.
    const linked = "See https://example.com/alpha for details.\n\nSome **al**pha text.\n";
    const linkedRendered = "See https://example.com/alpha for details.\nSome alpha text.";
    const alphaStart = linkedRendered.lastIndexOf("alpha");
    const alphaQuote = createAssistantTextSelector(linkedRendered, alphaStart, alphaStart + 5)!;
    expect(inferMarkdownSourceLineRange(linked, alphaQuote)).toEqual({ startLine: 3, endLine: 3 });
    expect(
      inferMarkdownSourceLineRange(linked, { ...alphaQuote, prefix: "", suffix: "" }),
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
      rangeLabel: 'L2:7 · "retryCount = 3"',
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
    expect(sourceSublineAnchors("line", contents, [lineComment], null).commentAnchors).toEqual([]);
    clearShadowSourceSublineHighlights("line");
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

  it("restores record quotes onto the selected occurrence within the recorded lines", () => {
    const sourceComment = (contents: string, start: number, end: number, line: number) => {
      const quote = createAssistantTextSelector(contents, start, end)!;
      const comment = buildSublineFileReviewComment({
        id: `comment-${line}-${start}`,
        filePath: "src/a.ts",
        sectionKind: "file",
        text: "Note.",
        quote,
        contents,
        startLine: line,
        endLine: line,
      });
      return { quote, comment, restored: throughRecord(comment) };
    };
    const resolvedQuote = (comment: ReviewCommentContext, contents: string) =>
      fileReviewCommentsFor([comment], "src/a.ts", contents)[0]?.quote;

    const repeated = "const y = x + x;\n";
    const second = sourceComment(
      repeated,
      repeated.lastIndexOf("x"),
      repeated.lastIndexOf("x") + 1,
      1,
    );
    expect(second.restored.rangeLabel).toBe('L1:15 · "x"');
    expect(resolvedQuote(second.restored, repeated)).toEqual(second.quote);
    // Without a column the occurrence is unknown: keep the comment, but do not guess a highlight.
    const unlocated = { ...second.restored, rangeLabel: 'L1 · "x"' };
    expect(fileReviewCommentsFor([unlocated], "src/a.ts", repeated)).toEqual([unlocated]);

    const wholeLine = "alpha\nbeta gamma\n";
    const line = sourceComment(wholeLine, 6, 16, 2);
    expect(resolvedQuote(line.restored, wholeLine)).toEqual(line.quote);

    const carriageReturns = "first\rsecond line\r";
    const cr = sourceComment(carriageReturns, 6, 12, 2);
    expect(resolvedQuote(cr.restored, carriageReturns)).toEqual(cr.quote);

    const crlf = "one\r\ntwo\r\n";
    const crlfLine = throughRecord(
      buildFileReviewComment({
        id: "comment-crlf",
        filePath: "src/a.ts",
        startLine: 2,
        endLine: 2,
        text: "Whole line.",
        contents: crlf,
      }),
    );
    expect(fileReviewCommentsFor([crlfLine], "src/a.ts", crlf)).toEqual([crlfLine]);
  });

  it("does not move a quote onto another occurrence of its text after an edit", () => {
    const contents = "const a = x + x;\n";
    const quote = createAssistantTextSelector(contents, 14, 15)!;
    const comment = buildSublineFileReviewComment({
      id: "comment-second-x",
      filePath: "src/a.ts",
      sectionKind: "file",
      text: "Rename.",
      quote,
      contents,
      startLine: 1,
      endLine: 1,
    });
    expect(comment.rangeLabel).toBe('L1:15 · "x"');

    // The editor rebuilds an edited comment from its remapped lines in the edited text.
    const remap = (edited: string, line = 1) => {
      const remapped = buildFileReviewComment({
        id: comment.id,
        filePath: "src/a.ts",
        startLine: line,
        endLine: line,
        text: comment.text,
        contents: edited,
      });
      return { remapped, result: remapQuotedFileComment(comment, contents, remapped) };
    };
    // Deleting " + x" leaves one "x", which is not the quoted occurrence.
    const edited = "const a = x;\n";
    const deleted = remap(edited);
    expect(deleted.result).toEqual(deleted.remapped);
    // Deleting "const a = x + " can only have kept the quoted occurrence.
    expect(remap("x;\n").result.rangeLabel).toBe('L1:1 · "x"');
    // Edits that provably keep the occurrence carry it to its new column or line.
    expect(remap("const ab = x + x;\n").result.rangeLabel).toBe('L1:16 · "x"');
    expect(remap("// note\nconst a = x + x;\n", 2).result).toMatchObject({
      rangeLabel: 'L2:15 · "x"',
      diff: "x",
      quote,
    });

    // Context only within the line cannot tell which "x" of "x + x;" survives as "x;".
    const short = "x + x;\n";
    const shortComment = buildSublineFileReviewComment({
      id: "comment-short",
      filePath: "src/a.ts",
      sectionKind: "file",
      text: "Rename.",
      quote: createAssistantTextSelector(short, 4, 5)!,
      contents: short,
      startLine: 1,
      endLine: 1,
    });
    expect(shortComment.rangeLabel).toBe('L1:5 · "x"');
    const shortRemapped = buildFileReviewComment({
      id: shortComment.id,
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 1,
      text: shortComment.text,
      contents: "x;\n",
    });
    expect(remapQuotedFileComment(shortComment, short, shortRemapped)).toEqual(shortRemapped);

    const restored = throughRecord(comment);
    expect(fileReviewCommentsFor([restored], "src/a.ts", edited)).toEqual([restored]);
    expect(sourceSublineAnchors("moved", edited, [restored], null).commentAnchors).toEqual([]);
    clearShadowSourceSublineHighlights("moved");
  });

  it("keeps the quote of a comment submitted on a later line of a CR-only file", () => {
    const contents = "first\rconst b = needle;\r";
    const start = contents.indexOf("needle");
    const quote = createAssistantTextSelector(contents, start, start + 6)!;
    const selection: SourceSelection = { contents, startLine: 2, endLine: 2, column: 10, quote };
    const submitted = buildFileReviewComment({
      id: "comment-cr",
      filePath: "src/a.ts",
      startLine: 2,
      endLine: 2,
      text: "Rename.",
      contents,
    });
    expect(quoteSubmittedFileComment(submitted, selection, contents)).toMatchObject({
      rangeLabel: 'L2:11 · "needle"',
      diff: "needle",
      quote,
    });

    // The captured column names the occurrence; an edit that may have moved it demotes the draft.
    const repeated = "const a = x + x;\n";
    const second: SourceSelection = {
      contents: repeated,
      startLine: 1,
      endLine: 1,
      column: 14,
      quote: createAssistantTextSelector(repeated, 14, 15)!,
    };
    const lineComment = (text: string) =>
      buildFileReviewComment({
        id: "comment-x",
        filePath: "src/a.ts",
        startLine: 1,
        endLine: 1,
        text: "Rename.",
        contents: text,
      });
    expect(quoteSubmittedFileComment(lineComment(repeated), second, repeated).rangeLabel).toBe(
      'L1:15 · "x"',
    );
    const edited = "const a = x;\n";
    expect(quoteSubmittedFileComment(lineComment(edited), second, edited)).toEqual(
      lineComment(edited),
    );
    expect(sourceSublineAnchors("draft", edited, [], second).draftAnchor).toBeNull();
    expect(sourceSublineAnchors("draft", repeated, [], second).draftAnchor).toEqual({
      startLine: 1,
      startColumn: 14,
      endLine: 1,
      endColumn: 15,
    });
    clearShadowSourceSublineHighlights("draft");
  });

  it("does not map rendered text into hidden YAML front matter", () => {
    // The front matter is not rendered, so its "alpha beta" only looks like the rendered entity.
    const markdown = "---\ntitle: alpha beta\n---\n\n&#97;lpha beta\n";
    const alpha = createAssistantTextSelector("alpha beta", 0, 5)!;
    expect(inferMarkdownSourceLineRange(markdown, alpha)).toBeNull();

    const body = "---\r\ntitle: gamma\r\n---\r\n\r\nThe gamma beta.\r\n";
    const rendered = "The gamma beta.";
    const gamma = createAssistantTextSelector(rendered, 4, 9)!;
    expect(inferMarkdownSourceLineRange(body, gamma)).toEqual({ startLine: 5, endLine: 5 });
  });

  it("drops the quote when an edit removes it from the recorded lines", () => {
    const contents = "const a = needle;\nconst b = needle;\n";
    const quote = createAssistantTextSelector(contents, 10, 16)!;
    const comment = buildSublineFileReviewComment({
      id: "comment-needle",
      filePath: "src/a.ts",
      sectionKind: "file",
      text: "Rename.",
      quote,
      contents,
      startLine: 1,
      endLine: 1,
    });
    const edited = "const a = other;\nconst b = needle;\n";
    expect(resolveFileReviewComment(comment, edited)).toBeNull();

    // Scrolling re-renders rows with equal inputs; the located anchors must be reused, not rescanned.
    const anchors = sourceSublineAnchors("surface", contents, [comment], null);
    expect(anchors.commentAnchors).toEqual([
      { startLine: 1, startColumn: 10, endLine: 1, endColumn: 16 },
    ]);
    expect(sourceSublineAnchors("surface", contents, [{ ...comment }], null)).toBe(anchors);
    expect(sourceSublineAnchors("surface", edited, [comment], null).commentAnchors).toEqual([]);
    clearShadowSourceSublineHighlights("surface");

    const remapped = buildFileReviewComment({
      id: comment.id,
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 1,
      text: comment.text,
      contents: edited,
    });
    expect(remapQuotedFileComment(comment, contents, remapped)).toEqual(remapped);
  });
});
