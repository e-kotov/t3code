import type { EditorChange } from "@pierre/diffs/edit";
import {
  createAssistantTextSelector,
  findAssistantCitationText,
  splitsSurrogatePair,
} from "@t3tools/shared/assistantCitations";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";

import { mathWrapperOf } from "~/markdown-clipboard";
import { inferReviewCommentFenceLanguage, type ReviewCommentContext } from "~/reviewCommentContext";
import type {
  FileCommentAnnotationEntry,
  FileCommentLineAnnotation,
} from "./fileCommentAnnotations";
import type { FileTextQuote } from "./forkFileTextQuote";

export const FILE_TEXT_QUOTE_MAX_LENGTH = 4000;
const QUOTE_LABEL_MAX_CHARS = 32;

export const MARKDOWN_COMMENT_HIGHLIGHT_NAME = "t3-file-markdown-comment";
export const MARKDOWN_COMMENT_ACTIVE_HIGHLIGHT_NAME = "t3-file-markdown-comment-active";
export const MARKDOWN_COMMENT_DRAFT_HIGHLIGHT_NAME = "t3-file-markdown-comment-draft";

const SOURCE_COMMENT_HIGHLIGHT_NAME = "t3-file-source-comment";
const SOURCE_COMMENT_DRAFT_HIGHLIGHT_NAME = "t3-file-source-comment-draft";

export const FORK_SOURCE_SUBLINE_UNSAFE_CSS = `
  ::highlight(${SOURCE_COMMENT_HIGHLIGHT_NAME}) {
    background-color: color-mix(in oklab, var(--primary) 26%, transparent);
  }
  ::highlight(${SOURCE_COMMENT_DRAFT_HIGHLIGHT_NAME}) {
    background-color: color-mix(in oklab, var(--primary) 38%, transparent);
  }
`;

function renderedMarkdownSectionId(filePath: string): string {
  return `file-rendered:${filePath}`;
}

function rawFileSectionId(filePath: string): string {
  return `file:${filePath}`;
}

function truncateSnippet(value: string, maxChars = QUOTE_LABEL_MAX_CHARS): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  let end = maxChars;
  if (splitsSurrogatePair(collapsed, end)) end -= 1;
  return `${collapsed.slice(0, end)}…`;
}

/** `column` (1-based, on the start line) tells a restored record which occurrence was quoted. */
export function formatQuotedRangeLabel(input: {
  readonly quoteText: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  readonly column?: number | undefined;
}): string {
  const snippet = `"${truncateSnippet(input.quoteText)}"`;
  if (input.startLine === undefined) return snippet;
  const startLine = Math.max(1, input.startLine);
  const endLine = Math.max(startLine, input.endLine ?? startLine);
  const start = input.column === undefined ? `L${startLine}` : `L${startLine}:${input.column}`;
  const linePart = endLine === startLine ? start : `${start} to L${endLine}`;
  return `${linePart} · ${snippet}`;
}

const QUOTED_LABEL = /^L\d+(?::(\d+))?(?: to L\d+)? · ".*"$/su;

function isQuotedLabel(rangeLabel: string): boolean {
  return QUOTED_LABEL.test(rangeLabel);
}

/** The label's start column as a 0-based offset into the start line. */
function labelColumnOffset(rangeLabel: string): number | undefined {
  const column = QUOTED_LABEL.exec(rangeLabel)?.[1];
  return column === undefined ? undefined : Number(column) - 1;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

function lineEndOf(text: string, starts: readonly number[], lineIndex: number): number {
  const next = starts[lineIndex + 1];
  if (next === undefined) return text.length;
  return text.startsWith("\r\n", next - 2) ? next - 2 : next - 1;
}

function lineIndexAtOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function rawTextOffset(text: string, normalizedOffset: number): number {
  let offset = 0;
  for (const match of text.matchAll(/\s+|\S+/g)) {
    const whitespace = /\s/.test(match[0][0]!);
    const length = whitespace ? 1 : match[0].length;
    if (normalizedOffset <= offset + length) {
      return (
        match.index +
        (whitespace && normalizedOffset > offset ? match[0].length : normalizedOffset - offset)
      );
    }
    offset += length;
  }
  return text.length;
}

function stripSimpleMarkdownInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
}

function lineRangeOf(text: string, match: { readonly start: number; readonly end: number }) {
  const starts = lineStartsOf(text);
  const rawStart = rawTextOffset(text, match.start);
  const rawEnd = Math.max(rawStart + 1, rawTextOffset(text, match.end));
  const startLine = lineIndexAtOffset(starts, rawStart) + 1;
  const endLine = lineIndexAtOffset(starts, rawEnd - 1) + 1;
  return { startLine, endLine: Math.max(startLine, endLine) };
}

/** A match whose rendered context agrees on at least one side; a lone occurrence is not proof. */
function verifiedMatch(text: string, quote: FileTextQuote) {
  const match = findAssistantCitationText(text, quote);
  if (match === null) return null;
  const normalized = text.replace(/\s+/g, " ");
  const prefix = quote.prefix.replace(/\s+/g, " ");
  const suffix = quote.suffix.replace(/\s+/g, " ");
  const prefixAgrees =
    prefix.length > 0 &&
    normalized.slice(Math.max(0, match.start - prefix.length), match.start) === prefix;
  const suffixAgrees =
    suffix.length > 0 && normalized.slice(match.end, match.end + suffix.length) === suffix;
  return prefixAgrees || suffixAgrees ? match : null;
}

/** Source lines of a rendered quote, or null when the mapping cannot be verified. */
export function inferMarkdownSourceLineRange(
  sourceText: string,
  quote: FileTextQuote,
): { readonly startLine: number; readonly endLine: number } | null {
  // The preview hides front matter; masking keeps line breaks, so lines stay aligned.
  const visible = maskMarkdownFrontmatter(sourceText);
  // Lines stay aligned with the source, so a match in the stripped text names source lines.
  const stripped = visible
    .split(/\r\n|\r|\n/)
    .map(stripSimpleMarkdownInline)
    .join("\n");
  const strippedMatch = verifiedMatch(stripped, quote);
  if (strippedMatch !== null) return lineRangeOf(stripped, strippedMatch);
  const rawMatch = verifiedMatch(visible, quote);
  return rawMatch === null ? null : lineRangeOf(visible, rawMatch);
}

type RawSpan = { readonly start: number; readonly end: number };

// Normalizing a prefix or suffix of a string yields a prefix or suffix of its normalization.
function normalizedBefore(text: string, index: number, length: number): string {
  for (let window = length + 16; ; window *= 2) {
    const from = Math.max(0, index - window);
    const normalized = text.slice(from, index).replace(/\s+/g, " ");
    if (normalized.length >= length || from === 0) return normalized.slice(-length);
  }
}

function normalizedAfter(text: string, index: number, length: number): string {
  for (let window = length + 16; ; window *= 2) {
    const to = Math.min(text.length, index + window);
    const normalized = text.slice(index, to).replace(/\s+/g, " ");
    if (normalized.length >= length || to === text.length) return normalized.slice(0, length);
  }
}

type QuoteContext = { readonly prefix: string; readonly suffix: string };

// Context cut off by the start or end of `text` is compatible, so a slice can be checked alone.
function contextAgrees(text: string, span: RawSpan, context: QuoteContext): boolean {
  const prefix = context.prefix.replace(/\s+/g, " ");
  const suffix = context.suffix.replace(/\s+/g, " ");
  const before = prefix.length === 0 ? "" : normalizedBefore(text, span.start, prefix.length);
  const after = suffix.length === 0 ? "" : normalizedAfter(text, span.end, suffix.length);
  return prefix.endsWith(before) && suffix.startsWith(after);
}

/**
 * Raw offsets of `quote` within `[from, to)`: the occurrence at `column` (an offset from `from`),
 * else the one whose context agrees. "ambiguous" when it cannot tell: a lone occurrence of the
 * same text is not proof that it is the quoted one.
 */
function locateQuote(
  text: string,
  from: number,
  to: number,
  quote: { readonly text: string } & Partial<QuoteContext>,
  column: number | undefined,
): RawSpan | "ambiguous" | null {
  if (quote.text.length === 0) return null;
  const region = text.slice(from, to);
  const spans: RawSpan[] = [];
  for (
    let index = region.indexOf(quote.text);
    index !== -1;
    index = region.indexOf(quote.text, index + 1)
  ) {
    spans.push({ start: from + index, end: from + index + quote.text.length });
  }
  if (spans.length === 0) return null;
  const atColumn =
    column === undefined ? undefined : spans.find((span) => span.start === from + column);
  if (atColumn) return atColumn;
  const { prefix, suffix } = quote;
  if (prefix !== undefined && suffix !== undefined) {
    const agreeing = spans.filter((span) => contextAgrees(text, span, { prefix, suffix }));
    if (agreeing.length === 1) return agreeing[0]!;
  }
  return "ambiguous";
}

function lineBounds(text: string, starts: readonly number[], startIndex: number, endIndex: number) {
  const from = starts[startIndex];
  if (from === undefined || endIndex < startIndex) return null;
  return { from, to: lineEndOf(text, starts, Math.min(endIndex, starts.length - 1)) };
}

/** 1-based column of `span` when it starts on the first line of `[from, …)`. */
function columnOnFirstLine(text: string, from: number, span: RawSpan): number | undefined {
  const lineBreak = text.slice(from, span.start).search(/\r|\n/);
  return lineBreak === -1 ? span.start - from + 1 : undefined;
}

/** A text selection as captured: `quote` starts `column` raw units into `startLine` of `contents`. */
export type SourceSelection = {
  readonly contents: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly column: number;
  readonly quote: FileTextQuote;
};

/** The captured selection's raw span, only within the exact `contents` it was captured from. */
function selectionSpanIn(selection: SourceSelection, contents: string): RawSpan | null {
  if (selection.contents !== contents) return null;
  const lineStart = lineStartsOf(contents)[selection.startLine - 1];
  if (lineStart === undefined) return null;
  const start = lineStart + selection.column;
  const span = { start, end: start + selection.quote.text.length };
  return contents.slice(span.start, span.end) === selection.quote.text ? span : null;
}

/** 1-based column of `span` when it lies within the comment's lines and starts on the first. */
function columnWithinLines(
  contents: string,
  startIndex: number,
  endIndex: number,
  span: RawSpan | "ambiguous" | null,
): number | undefined {
  if (span === null || span === "ambiguous") return undefined;
  const bounds = lineBounds(contents, lineStartsOf(contents), startIndex, endIndex);
  if (bounds === null || span.start < bounds.from || span.end > bounds.to) return undefined;
  return columnOnFirstLine(contents, bounds.from, span);
}

export function buildSublineFileReviewComment(input: {
  readonly id: string;
  readonly filePath: string;
  readonly sectionKind: "file" | "file-rendered";
  readonly text: string;
  readonly quote: FileTextQuote;
  readonly contents: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
  /** The captured selection, which names the quoted occurrence. */
  readonly selection?: SourceSelection | undefined;
}): ReviewCommentContext {
  const inferred =
    input.startLine !== undefined
      ? {
          startLine: Math.max(1, input.startLine),
          endLine: Math.max(Math.max(1, input.startLine), input.endLine ?? input.startLine),
        }
      : input.sectionKind === "file-rendered"
        ? inferMarkdownSourceLineRange(input.contents, input.quote)
        : null;

  let column: number | undefined;
  if (input.sectionKind === "file" && inferred) {
    const startIndex = inferred.startLine - 1;
    const endIndex = inferred.endLine - 1;
    const bounds = lineBounds(input.contents, lineStartsOf(input.contents), startIndex, endIndex);
    const span = input.selection
      ? selectionSpanIn(input.selection, input.contents)
      : bounds && locateQuote(input.contents, bounds.from, bounds.to, input.quote, undefined);
    column = columnWithinLines(input.contents, startIndex, endIndex, span);
  }

  const startIndex = inferred ? inferred.startLine - 1 : 0;
  const endIndex = inferred ? inferred.endLine - 1 : 0;
  return {
    id: input.id,
    sectionId:
      input.sectionKind === "file-rendered"
        ? renderedMarkdownSectionId(input.filePath)
        : rawFileSectionId(input.filePath),
    // oxlint-disable-next-line t3code/no-untranslated-copy -- stored in the review comment record sent to the agent
    sectionTitle: "File comment",
    filePath: input.filePath,
    startIndex,
    endIndex,
    rangeLabel: formatQuotedRangeLabel({
      quoteText: input.quote.text,
      startLine: inferred?.startLine,
      endLine: inferred?.endLine,
      column,
    }),
    text: input.text.trim(),
    diff: input.quote.text,
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
    quote: input.quote,
  };
}

function withQuote(
  comment: ReviewCommentContext,
  quoteText: string,
  quote: FileTextQuote | undefined,
  column: number | undefined,
): ReviewCommentContext {
  return {
    ...comment,
    rangeLabel: formatQuotedRangeLabel({
      quoteText,
      startLine: comment.startIndex + 1,
      endLine: comment.endIndex + 1,
      column,
    }),
    diff: quoteText,
    ...(quote ? { quote } : {}),
  };
}

/**
 * Quotes a whole-line comment built from `contents` for a submitted selection. Returns the plain
 * line comment when the selected occurrence is no longer certain within the comment's lines.
 */
export function quoteSubmittedFileComment(
  comment: ReviewCommentContext,
  selection: SourceSelection,
  contents: string,
): ReviewCommentContext {
  const span = selectionSpanIn(selection, contents);
  const column = columnWithinLines(contents, comment.startIndex, comment.endIndex, span);
  if (span === null || column === undefined) return comment;
  const quote = createAssistantTextSelector(contents, span.start, span.end) ?? selection.quote;
  return withQuote(comment, quote.text, quote, column);
}

/** An editor change: the replaced range in the text before it, and the inserted text. */
export type FileTextChange = Pick<EditorChange, "range" | "text">;

/**
 * Carries a stored comment through one editor change event to `comment`, the plain line comment
 * rebuilt at the editor's remapped lines. A quote survives only when no change touches its lines,
 * which then keep their exact text and column, and the lines moved as the changes above imply.
 */
export function carryQuotedFileComment(
  previous: ReviewCommentContext,
  changes: ReadonlyArray<FileTextChange>,
  comment: ReviewCommentContext,
): ReviewCommentContext {
  if (!previous.quote && !isQuotedLabel(previous.rangeLabel)) return comment;
  const first = previous.startIndex;
  const last = previous.endIndex;
  let shift = 0;
  for (const { range, text } of changes) {
    if (range.start.line > last) continue;
    // Whole lines replaced right above the quote end at its first column, after a line break.
    const linesAbove =
      range.start.character === 0 &&
      range.end.line === first &&
      range.end.character === 0 &&
      (text === "" || text.endsWith("\n"));
    if (range.end.line >= first && !linesAbove) return comment;
    shift += (text.match(/\r\n|\r|\n/g)?.length ?? 0) - (range.end.line - range.start.line);
  }
  if (comment.startIndex !== first + shift || comment.endIndex !== last + shift) return comment;
  const column = labelColumnOffset(previous.rangeLabel);
  return withQuote(
    comment,
    previous.quote?.text ?? previous.diff,
    previous.quote,
    column === undefined ? undefined : column + 1,
  );
}

/** Line tables of one file version, built on first use and shared by its comments. */
function fileLines(contents: string) {
  let starts: number[] | undefined;
  let lines: string[] | undefined;
  return {
    starts: () => (starts ??= lineStartsOf(contents)),
    // Upstream `buildFileReviewComment` cuts whole-line comments on "\n" alone.
    lines: () => (lines ??= contents.split("\n")),
  };
}

/** Where a source comment's quote sits in `contents`, searched only within its recorded lines. */
function locateSourceComment(
  comment: ReviewCommentContext,
  contents: string,
  starts: readonly number[],
): RawSpan | "ambiguous" | null {
  const bounds = lineBounds(contents, starts, comment.startIndex, comment.endIndex);
  if (bounds === null) return null;
  // Composer context records (stash, import into another thread) drop the client-only quote.
  const quote = comment.quote ?? { text: comment.diff };
  return locateQuote(
    contents,
    bounds.from,
    bounds.to,
    quote,
    labelColumnOffset(comment.rangeLabel),
  );
}

/**
 * The comment if it still applies to `contents`. A record that dropped its quote gets it back
 * when the quoted occurrence is certain; an ambiguous one stays a comment without a highlight.
 */
export function resolveFileReviewComment(
  comment: ReviewCommentContext,
  contents: string,
  lines = fileLines(contents),
): ReviewCommentContext | null {
  if (!comment.quote && !isQuotedLabel(comment.rangeLabel)) {
    const slice = lines
      .lines()
      .slice(comment.startIndex, comment.endIndex + 1)
      .join("\n");
    return slice === comment.diff ? comment : null;
  }
  const span = locateSourceComment(comment, contents, lines.starts());
  if (span === null) return null;
  if (comment.quote || span === "ambiguous") return comment;
  const quote = createAssistantTextSelector(contents, span.start, span.end);
  return quote ? { ...comment, quote } : comment;
}

export function fileReviewCommentsFor(
  comments: ReadonlyArray<ReviewCommentContext>,
  filePath: string,
  contents: string,
): ReviewCommentContext[] {
  const sectionId = rawFileSectionId(filePath);
  const lines = fileLines(contents);
  return comments.flatMap((comment) => {
    if (comment.sectionId !== sectionId) return [];
    const resolved = resolveFileReviewComment(comment, contents, lines);
    return resolved ? [resolved] : [];
  });
}

export function renderedMarkdownCommentsFor(
  comments: ReadonlyArray<ReviewCommentContext>,
  filePath: string,
): ReviewCommentContext[] {
  const sectionId = renderedMarkdownSectionId(filePath);
  return comments.flatMap((comment) => {
    if (comment.sectionId !== sectionId) return [];
    // A record without the quote still anchors when its rendered text is unique.
    const quote = comment.quote ?? { text: comment.diff, start: 0, end: 0, prefix: "", suffix: "" };
    return [{ ...comment, quote }];
  });
}

const CONTROL_SELECTOR =
  "button, input, textarea, select, [role=button], [contenteditable], [data-file-comment-ui], [data-diff-comment-annotation]";
const EXCLUDED_SELECTOR = `${CONTROL_SELECTOR}, [hidden], [aria-hidden=true], script, style, template, noscript, svg`;
const BLOCK_SELECTOR =
  "address, article, aside, blockquote, dd, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul";

type TextChunk = { readonly node: Text | Element; readonly start: number; readonly end: number };

const isText = (node: Node): node is Text => node.nodeType === 3;

function readContainerText(root: HTMLElement) {
  const parts: string[] = [];
  const chunks: TextChunk[] = [];
  let length = 0;
  let separator = false;

  const append = (node: Text | Element, text: string) => {
    if (separator && length > 0) {
      parts.push("\n");
      length += 1;
    }
    separator = false;
    chunks.push({ node, start: length, end: length + text.length });
    parts.push(text);
    length += text.length;
  };

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.length > 0) append(text, text.data);
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(EXCLUDED_SELECTOR)) return;
    const block = element.matches(BLOCK_SELECTOR);
    if (block || element.tagName === "BR") separator = true;
    if (element.matches("[data-markdown-math]")) {
      append(element, element.getAttribute("data-markdown-copy")?.trim() ?? "");
    } else {
      for (const child of element.childNodes) visit(child);
    }
    if (block) separator = true;
  };

  visit(root);
  return { text: parts.join(""), chunks };
}

function excludedAncestor(root: HTMLElement, node: Node): Element | null {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const closest = element?.closest(EXCLUDED_SELECTOR) ?? null;
  return closest && root.contains(closest) ? closest : null;
}

function isUsableRange(root: HTMLElement, range: Range): boolean {
  return !(
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer) ||
    excludedAncestor(root, range.startContainer) !== null ||
    excludedAncestor(root, range.endContainer) !== null
  );
}

function isUnselectable(text: Text): boolean {
  const element = mathWrapperOf(text.parentElement) ?? text.parentElement;
  const view = element?.ownerDocument?.defaultView;
  return !!element && !!view && view.getComputedStyle(element).userSelect === "none";
}

function selectedTextBoundary(range: Range, node: Node, last: boolean): Text | null {
  if (!range.intersectsNode(node)) return null;
  if (node.nodeType === 3) {
    const text = node as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : text.length;
    return start < end && !isUnselectable(text) ? text : null;
  }
  if (node.nodeType === 1 && (node as Element).matches(EXCLUDED_SELECTOR)) return null;
  for (
    let child = last ? node.lastChild : node.firstChild;
    child !== null;
    child = last ? child.previousSibling : child.nextSibling
  ) {
    const boundary = selectedTextBoundary(range, child, last);
    if (boundary !== null) return boundary;
  }
  return null;
}

export function captureContainerTextSelection(
  root: HTMLElement,
  selection: Selection | null,
): { readonly quote: FileTextQuote; readonly range: Range } | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const first = selectedTextBoundary(range, range.commonAncestorContainer, false);
  const last = selectedTextBoundary(range, range.commonAncestorContainer, true);
  if (first === null || last === null) return null;

  const startFormula = mathWrapperOf(first.parentElement);
  const endFormula = mathWrapperOf(last.parentElement);
  if (startFormula) range.setStartBefore(startFormula);
  else range.setStart(first, first === range.startContainer ? range.startOffset : 0);
  if (endFormula) range.setEndAfter(endFormula);
  else range.setEnd(last, last === range.endContainer ? range.endOffset : last.length);
  if (!isUsableRange(root, range)) return null;

  const stream = readContainerText(root);
  let rawStart: number | null = null;
  let rawEnd = 0;
  for (const chunk of stream.chunks) {
    if (!range.intersectsNode(chunk.node)) continue;
    const start = range.startContainer === chunk.node ? range.startOffset : 0;
    const end = range.endContainer === chunk.node ? range.endOffset : chunk.end - chunk.start;
    if (start === end) continue;
    rawStart ??= chunk.start + start;
    rawEnd = chunk.start + end;
  }
  if (rawStart === null) return null;
  const quote = createAssistantTextSelector(stream.text, rawStart, rawEnd);
  return quote === null ? null : { quote, range };
}

export function resolveContainerTextQuoteRange(
  root: HTMLElement,
  quote: FileTextQuote,
): Range | null {
  if (excludedAncestor(root, root) !== null) return null;
  const stream = readContainerText(root);
  const match = findAssistantCitationText(stream.text, quote);
  if (match === null) return null;

  const start = rawTextOffset(stream.text, match.start);
  const end = rawTextOffset(stream.text, match.end);
  const first = stream.chunks.find((chunk) => chunk.end > start);
  const last = stream.chunks.findLast((chunk) => chunk.start < end);
  if (first === undefined || last === undefined) return null;

  const range = root.ownerDocument.createRange();
  if (isText(first.node)) range.setStart(first.node, Math.max(0, start - first.start));
  else range.setStartBefore(first.node);
  if (isText(last.node)) range.setEnd(last.node, Math.min(last.node.length, end - last.start));
  else range.setEndAfter(last.node);
  return isUsableRange(root, range) ? range : null;
}

const SHADOW_EXCLUDED_SELECTOR =
  "[data-column-number], [data-diff-comment-annotation], button, input, textarea, select, [role=button]";

function shadowRowOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-line]") ?? null;
}

function isExcludedShadowNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(SHADOW_EXCLUDED_SELECTOR) !== null;
}

function columnWithinRow(row: HTMLElement, node: Node, offset: number): number {
  const range = row.ownerDocument.createRange();
  range.setStart(row, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function resolveShadowLinePoint(
  rows: readonly HTMLElement[],
  node: Node,
  offset: number,
  side: "start" | "end",
  lineLength: (line: number) => number,
): { readonly line: number; readonly column: number } | null {
  const row = shadowRowOf(node);
  if (row) {
    const line = Number(row.dataset.line);
    if (!Number.isFinite(line) || line < 1) return null;
    const column = Math.min(lineLength(line), Math.max(0, columnWithinRow(row, node, offset)));
    return { line, column };
  }
  const probe = node.ownerDocument?.createRange();
  if (!probe) return null;
  probe.setStart(node, offset);
  if (side === "start") {
    const near = rows.find((candidate) => probe.comparePoint(candidate, 0) >= 0);
    if (!near) return null;
    const line = Number(near.dataset.line);
    return Number.isFinite(line) && line >= 1 ? { line, column: 0 } : null;
  }
  const near = rows.findLast(
    (candidate) => probe.comparePoint(candidate, candidate.childNodes.length) <= 0,
  );
  if (!near) return null;
  const line = Number(near.dataset.line);
  return Number.isFinite(line) && line >= 1 ? { line, column: lineLength(line) } : null;
}

export function captureShadowSourceTextSelection(
  shadowRoot: ShadowRoot,
  contents: string,
  selection: Selection | null,
): {
  readonly startLine: number;
  readonly endLine: number;
  readonly column: number;
  readonly quote: FileTextQuote;
  readonly rect: DOMRect;
  readonly lastRect: DOMRect;
} | null {
  if (!selection) return null;
  let staticRange: StaticRange | undefined;
  try {
    staticRange = selection.getComposedRanges({ shadowRoots: [shadowRoot] })[0];
  } catch {
    if (selection.isCollapsed) return null;
    staticRange = selection.rangeCount === 1 ? selection.getRangeAt(0) : undefined;
  }
  if (!staticRange || staticRange.collapsed) return null;
  if (
    !shadowRoot.contains(staticRange.startContainer) ||
    !shadowRoot.contains(staticRange.endContainer)
  ) {
    return null;
  }
  if (
    isExcludedShadowNode(staticRange.startContainer) ||
    isExcludedShadowNode(staticRange.endContainer)
  ) {
    return null;
  }

  const rows = [...shadowRoot.querySelectorAll<HTMLElement>("[data-line]")];
  if (rows.length === 0) return null;

  const starts = lineStartsOf(contents);
  const lineLength = (line: number) => {
    const index = line - 1;
    const start = starts[index];
    if (start === undefined) return 0;
    return Math.max(0, lineEndOf(contents, starts, index) - start);
  };

  const startPoint = resolveShadowLinePoint(
    rows,
    staticRange.startContainer,
    staticRange.startOffset,
    "start",
    lineLength,
  );
  const endPoint = resolveShadowLinePoint(
    rows,
    staticRange.endContainer,
    staticRange.endOffset,
    "end",
    lineLength,
  );
  if (!startPoint || !endPoint) return null;

  let startLine = startPoint.line;
  const startColumn = startPoint.column;
  let endLine = endPoint.line;
  let endColumn = endPoint.column;

  if (endLine > startLine && endColumn === 0) {
    endLine -= 1;
    endColumn = lineLength(endLine);
  }
  if (endLine < startLine || (endLine === startLine && endColumn <= startColumn)) {
    return null;
  }

  const rawStart = (starts[startLine - 1] ?? 0) + startColumn;
  const rawEnd = (starts[endLine - 1] ?? 0) + endColumn;
  const quote = createAssistantTextSelector(contents, rawStart, rawEnd);
  if (!quote) return null;

  const domRange = shadowRoot.ownerDocument.createRange();
  domRange.setStart(staticRange.startContainer, staticRange.startOffset);
  domRange.setEnd(staticRange.endContainer, staticRange.endOffset);
  const rect = domRange.getBoundingClientRect();
  const rects = domRange.getClientRects();
  const lastRect = rects.item(rects.length - 1) ?? rect;
  if (rect.width <= 0 && rect.height <= 0 && lastRect.width <= 0 && lastRect.height <= 0) {
    return null;
  }

  return {
    startLine,
    endLine,
    column: startColumn,
    quote,
    rect,
    lastRect,
  };
}

function pointWithinShadowRow(
  row: HTMLElement,
  column: number,
): { readonly node: Node; readonly offset: number } {
  let remaining = Math.max(0, column);
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return { node: row, offset: row.childNodes.length };
}

/** 1-based lines and raw 0-based columns of a located quote. */
type SourceAnchor = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

function anchorOf(starts: readonly number[], span: RawSpan | "ambiguous" | null) {
  if (span === null || span === "ambiguous" || span.end <= span.start) return null;
  const startIndex = lineIndexAtOffset(starts, span.start);
  const endIndex = lineIndexAtOffset(starts, span.end - 1);
  return {
    startLine: startIndex + 1,
    startColumn: span.start - starts[startIndex]!,
    endLine: endIndex + 1,
    endColumn: span.end - starts[endIndex]!,
  };
}

function sameAnchorInput(left: ReviewCommentContext, right: ReviewCommentContext): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.startIndex === right.startIndex &&
      left.endIndex === right.endIndex &&
      left.rangeLabel === right.rangeLabel &&
      left.diff === right.diff &&
      left.quote?.text === right.quote?.text &&
      left.quote?.prefix === right.quote?.prefix &&
      left.quote?.suffix === right.quote?.suffix)
  );
}

type SourceAnchors = {
  readonly contents: string;
  readonly starts: readonly number[];
  readonly comments: ReadonlyArray<ReviewCommentContext>;
  readonly commentAnchors: ReadonlyArray<SourceAnchor>;
  readonly draft: SourceSelection | null;
  readonly draftAnchor: SourceAnchor | null;
};

const sourceAnchorsBySurface = new Map<string, SourceAnchors>();

/**
 * Located quotes for one surface, recomputed only when contents, comments, or the draft change.
 * Virtualized rows re-render on scroll and must only project these onto mounted rows.
 */
export function sourceSublineAnchors(
  surfaceKey: string,
  contents: string,
  comments: ReadonlyArray<ReviewCommentContext>,
  draft: SourceSelection | null,
): SourceAnchors {
  const cached = sourceAnchorsBySurface.get(surfaceKey);
  const sameContents = cached?.contents === contents;
  const sameComments =
    sameContents &&
    cached.comments.length === comments.length &&
    cached.comments.every((comment, index) => sameAnchorInput(comment, comments[index]!));
  const sameDraft =
    sameContents &&
    (cached.draft === draft ||
      (cached.draft !== null &&
        draft !== null &&
        cached.draft.quote === draft.quote &&
        cached.draft.contents === draft.contents &&
        cached.draft.startLine === draft.startLine &&
        cached.draft.column === draft.column));
  if (cached && sameComments && sameDraft) return cached;

  const starts = sameContents ? cached.starts : lineStartsOf(contents);
  const commentAnchors = sameComments
    ? cached.commentAnchors
    : comments.flatMap((comment) => {
        // Whole-line comments and ambiguous restores carry no quote, so they get no text highlight.
        if (!comment.quote) return [];
        const anchor = anchorOf(starts, locateSourceComment(comment, contents, starts));
        return anchor ? [anchor] : [];
      });
  let draftAnchor = sameDraft ? cached.draftAnchor : null;
  if (!sameDraft) draftAnchor = draft ? anchorOf(starts, selectionSpanIn(draft, contents)) : null;
  const next = { contents, starts, comments, commentAnchors, draft, draftAnchor };
  sourceAnchorsBySurface.set(surfaceKey, next);
  return next;
}

function projectSourceAnchor(
  document: Document,
  rows: ReadonlyMap<number, HTMLElement>,
  mounted: { readonly first: number; readonly last: number },
  anchor: SourceAnchor,
): Range | null {
  if (anchor.endLine < mounted.first || anchor.startLine > mounted.last) return null;
  const startLine = Math.max(anchor.startLine, mounted.first);
  const endLine = Math.min(anchor.endLine, mounted.last);
  const startRow = rows.get(startLine);
  const endRow = rows.get(endLine);
  if (!startRow || !endRow) return null;
  const startPoint = pointWithinShadowRow(
    startRow,
    startLine === anchor.startLine ? anchor.startColumn : 0,
  );
  const endPoint = pointWithinShadowRow(
    endRow,
    endLine === anchor.endLine ? anchor.endColumn : Number.POSITIVE_INFINITY,
  );
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range.collapsed ? null : range;
}

const sourceHighlightSurfaceRanges = new Map<
  string,
  { readonly comments: Range[]; readonly drafts: Range[] }
>();

function rebuildSourceHighlights() {
  if (typeof Highlight === "undefined" || typeof CSS === "undefined" || !CSS.highlights) return;
  const commentRanges: Range[] = [];
  const draftRanges: Range[] = [];
  for (const entry of sourceHighlightSurfaceRanges.values()) {
    commentRanges.push(...entry.comments);
    draftRanges.push(...entry.drafts);
  }
  if (commentRanges.length > 0) {
    CSS.highlights.set(SOURCE_COMMENT_HIGHLIGHT_NAME, new Highlight(...commentRanges));
  } else {
    CSS.highlights.delete(SOURCE_COMMENT_HIGHLIGHT_NAME);
  }
  if (draftRanges.length > 0) {
    CSS.highlights.set(SOURCE_COMMENT_DRAFT_HIGHLIGHT_NAME, new Highlight(...draftRanges));
  } else {
    CSS.highlights.delete(SOURCE_COMMENT_DRAFT_HIGHLIGHT_NAME);
  }
}

export function syncShadowSourceSublineHighlights(input: {
  readonly surfaceKey: string;
  readonly shadowRoot: ShadowRoot | null | undefined;
  readonly contents: string;
  readonly comments: ReadonlyArray<ReviewCommentContext>;
  readonly draft?: SourceSelection | null | undefined;
}): void {
  const { surfaceKey, shadowRoot, contents, comments, draft } = input;
  if (!shadowRoot) {
    clearShadowSourceSublineHighlights(surfaceKey);
    return;
  }
  const anchors = sourceSublineAnchors(surfaceKey, contents, comments, draft ?? null);
  const commentRanges: Range[] = [];
  const draftRanges: Range[] = [];
  if (anchors.commentAnchors.length > 0 || anchors.draftAnchor) {
    const rows = new Map<number, HTMLElement>();
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const row of shadowRoot.querySelectorAll<HTMLElement>("[data-line]")) {
      const line = Number(row.dataset.line);
      if (!Number.isFinite(line) || rows.has(line)) continue;
      rows.set(line, row);
      first = Math.min(first, line);
      last = Math.max(last, line);
    }
    const document = shadowRoot.ownerDocument;
    for (const anchor of anchors.commentAnchors) {
      const range = projectSourceAnchor(document, rows, { first, last }, anchor);
      if (range) commentRanges.push(range);
    }
    const draftRange =
      anchors.draftAnchor &&
      projectSourceAnchor(document, rows, { first, last }, anchors.draftAnchor);
    if (draftRange) draftRanges.push(draftRange);
  }
  const hadRanges = sourceHighlightSurfaceRanges.has(surfaceKey);
  if (commentRanges.length === 0 && draftRanges.length === 0) {
    sourceHighlightSurfaceRanges.delete(surfaceKey);
    if (!hadRanges) return;
  } else {
    sourceHighlightSurfaceRanges.set(surfaceKey, { comments: commentRanges, drafts: draftRanges });
  }
  rebuildSourceHighlights();
}

export function clearShadowSourceSublineHighlights(surfaceKey: string): void {
  sourceAnchorsBySurface.delete(surfaceKey);
  if (sourceHighlightSurfaceRanges.delete(surfaceKey)) {
    rebuildSourceHighlights();
  }
}

/** `annotations` plus entries for prompt comments it lacks, such as ones imported while open. */
export function withPromptCommentAnnotations(
  annotations: FileCommentLineAnnotation[],
  comments: ReadonlyArray<ReviewCommentContext>,
): FileCommentLineAnnotation[] {
  const annotated = new Set(
    annotations.flatMap((annotation) => annotation.metadata.entries.map((entry) => entry.id)),
  );
  const missing = comments.filter((comment) => !annotated.has(comment.id));
  if (missing.length === 0) return annotations;
  const next = annotations.map((annotation) => ({
    ...annotation,
    metadata: { entries: [...annotation.metadata.entries] },
  }));
  for (const comment of missing) {
    const lineNumber = comment.endIndex + 1;
    const entry: FileCommentAnnotationEntry = {
      id: comment.id,
      kind: "comment",
      startLine: comment.startIndex + 1,
      endLine: lineNumber,
      text: comment.text,
    };
    const existing = next.find((item) => item.lineNumber === lineNumber);
    if (existing) existing.metadata.entries.push(entry);
    else next.push({ lineNumber, metadata: { entries: [entry] } });
  }
  return next;
}
