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
  carryQuotedFileComment,
  clearShadowSourceSublineHighlights,
  type FileTextChange,
  fileReviewCommentsFor,
  formatQuotedRangeLabel,
  inferMarkdownSourceLineRange,
  quoteSubmittedFileComment,
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

function change(
  [startLine, startCharacter]: readonly [number, number],
  [endLine, endCharacter]: readonly [number, number],
  text = "",
): FileTextChange {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    text,
  };
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

  it("demotes a quote to a line comment when an edit touches its lines", () => {
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
    const lineComment = (edited: string, line: number) =>
      buildFileReviewComment({
        id: comment.id,
        filePath: "src/a.ts",
        startLine: line,
        endLine: line,
        text: comment.text,
        contents: edited,
      });
    const carry = (
      previous: ReviewCommentContext,
      changes: ReadonlyArray<FileTextChange>,
      edited: string,
      line: number,
    ) => {
      const remapped = lineComment(edited, line);
      return { remapped, result: carryQuotedFileComment(previous, changes, remapped) };
    };

    // Any change on the quoted line demotes, whether or not the quoted "x" still looks the same.
    for (const [changes, edited] of [
      [[change([0, 11], [0, 15])], "const a = x;\n"],
      [[change([0, 0], [0, 14])], "x;\n"],
      [[change([0, 7], [0, 7], "b")], "const ab = x + x;\n"],
      [[change([0, 0], [0, 0], "// note")], "// noteconst a = x + x;\n"],
      [[change([0, 16], [0, 16], "\n")], "const a = x + x;\n\n"],
    ] as const) {
      const { remapped, result } = carry(comment, changes, edited, 1);
      expect(result).toEqual(remapped);
    }

    // Lines inserted or removed above move the quote; its line text and column are unchanged.
    const moved = "// note\nconst a = x + x;\n";
    const below = carry(comment, [change([0, 0], [0, 0], "// note\n")], moved, 2).result;
    expect(below).toMatchObject({ rangeLabel: 'L2:15 · "x"', diff: "x", quote });
    expect(carry(below, [change([0, 0], [1, 0])], contents, 1).result).toEqual({
      ...lineComment(contents, 1),
      rangeLabel: 'L1:15 · "x"',
      diff: "x",
      quote,
    });
    // A change below the quote and one above it in the same event shift it by the net lines.
    const both = "// note\na\nconst a = x + x;\nc;";
    const shifted = carry(
      below,
      [change([0, 7], [0, 7], "\na"), change([2, 0], [2, 0], "c;")],
      both,
      3,
    ).result;
    expect(shifted.rangeLabel).toBe('L3:15 · "x"');
    // One of the event's changes on the quoted line demotes it.
    const touched = carry(
      below,
      [change([0, 0], [0, 0], "a\n"), change([1, 7], [1, 7], "b")],
      "a\n// note\nconst ab = x + x;\n",
      3,
    );
    expect(touched.result).toEqual(touched.remapped);
    // The editor's own line remap must agree with the changes, or the quote is dropped.
    const disagreeing = carry(comment, [change([0, 0], [0, 0], "// note\n")], moved, 1);
    expect(disagreeing.result).toEqual(disagreeing.remapped);

    // Deleting "x);\nbar(" splices the "x" of "bar(x)" onto line 1, whose text reads the same.
    const splice = "foo(x);\nbar(x);\n";
    const spliceComment = buildSublineFileReviewComment({
      id: "comment-splice",
      filePath: "src/a.ts",
      sectionKind: "file",
      text: "Rename.",
      quote: createAssistantTextSelector(splice, 4, 5)!,
      contents: splice,
      startLine: 1,
      endLine: 1,
    });
    expect(spliceComment.rangeLabel).toBe('L1:5 · "x"');
    const spliced = carry(spliceComment, [change([0, 4], [1, 4])], "foo(x);\n", 1);
    expect(spliced.result).toEqual(spliced.remapped);

    // Touching ranges of one event act as one: these two splice the quoted "x" onto line 1.
    const lower = "x;\nabove;\nx;\n";
    const lowerComment = buildSublineFileReviewComment({
      id: "comment-lower-x",
      filePath: "src/a.ts",
      sectionKind: "file",
      text: "Rename.",
      quote: createAssistantTextSelector(lower, 10, 11)!,
      contents: lower,
      startLine: 3,
      endLine: 3,
    });
    expect(lowerComment.rangeLabel).toBe('L3:1 · "x"');
    const joined = carry(
      lowerComment,
      [change([0, 1], [1, 0]), change([1, 0], [2, 0])],
      "xx;\n",
      1,
    );
    expect(joined.result).toEqual(joined.remapped);
    // A replacement from mid-line above that ends in a line break leaves the quoted line whole.
    const kept = carry(lowerComment, [change([0, 1], [2, 0], "y\n")], "xy\nx;\n", 2).result;
    expect(kept).toMatchObject({ rangeLabel: 'L2:1 · "x"', diff: "x", quote: lowerComment.quote });
    for (const [changes, edited] of [
      [[change([0, 1], [2, 0], "y")], "xyx;\n"],
      [[change([0, 1], [2, 0])], "xx;\n"],
      // Inserts at one position have no defined order, so the line break may come first.
      [[change([2, 0], [2, 0], "a\n"), change([2, 0], [2, 0], "b")], "x;\nabove;\na\nbx;\n"],
    ] as const) {
      const line = edited.split("\n").length - 1;
      const { remapped, result } = carry(lowerComment, changes, edited, line);
      expect(result).toEqual(remapped);
    }

    const restored = throughRecord(comment);
    const edited = "const a = x;\n";
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
    expect(carryQuotedFileComment(comment, [change([0, 10], [0, 16], "other")], remapped)).toEqual(
      remapped,
    );
  });
});
