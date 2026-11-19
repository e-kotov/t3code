import {
  createAssistantTextSelector,
  findAssistantCitationText,
  splitsSurrogatePair,
} from "@t3tools/shared/assistantCitations";
import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { mathWrapperOf } from "~/markdown-clipboard";
import { buildFileReviewComment, inferReviewCommentFenceLanguage, type ReviewCommentContext } from "~/reviewCommentContext";
import {
  type FileCommentAnnotationEntry,
  type FileCommentLineAnnotation,
  formatFileCommentRange,
} from "./fileCommentAnnotations";

export const FILE_TEXT_QUOTE_MAX_LENGTH = 4000;
const QUOTE_LABEL_MAX_CHARS = 32;

export const FileTextQuoteSchema = Schema.Struct({
  text: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  prefix: Schema.String,
  suffix: Schema.String,
});

export type FileTextQuote = typeof FileTextQuoteSchema.Type;

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

export function renderedMarkdownSectionId(filePath: string): string {
  return `file-rendered:${filePath}`;
}

export function rawFileSectionId(filePath: string): string {
  return `file:${filePath}`;
}

function truncateSnippet(value: string, maxChars = QUOTE_LABEL_MAX_CHARS): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  let end = maxChars;
  if (splitsSurrogatePair(collapsed, end)) end -= 1;
  return `${collapsed.slice(0, end)}…`;
}

export function formatQuotedRangeLabel(input: {
  readonly quoteText: string;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}): string {
  const snippet = `"${truncateSnippet(input.quoteText)}"`;
  if (input.startLine === undefined) return snippet;
  const startLine = Math.max(1, input.startLine);
  const endLine = Math.max(startLine, input.endLine ?? startLine);
  // oxlint-disable-next-line t3code/no-untranslated-copy -- stored in the review comment record sent to the agent
  const linePart = endLine === startLine ? `L${startLine}` : `L${startLine} to L${endLine}`;
  return `${linePart} · ${snippet}`;
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

export function inferMarkdownSourceLineRange(
  sourceText: string,
  quote: FileTextQuote,
): { readonly startLine: number; readonly endLine: number } | null {
  const starts = lineStartsOf(sourceText);
  const direct = findAssistantCitationText(sourceText, quote);
  if (direct !== null) {
    const rawStart = rawTextOffset(sourceText, direct.start);
    const rawEnd = Math.max(rawStart + 1, rawTextOffset(sourceText, direct.end));
    const startLine = lineIndexAtOffset(starts, rawStart) + 1;
    const endLine = lineIndexAtOffset(starts, Math.max(rawStart, rawEnd - 1)) + 1;
    return { startLine, endLine: Math.max(startLine, endLine) };
  }

  const normalizedQuote = quote.text.replace(/\s+/g, " ").trim();
  if (normalizedQuote.length === 0 || normalizedQuote.includes("\n")) return null;
  const lines = sourceText.split(/\r\n|\r|\n/);
  let matchedLine: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const stripped = stripSimpleMarkdownInline(lines[index]!).replace(/\s+/g, " ");
    if (!stripped.includes(normalizedQuote)) continue;
    if (matchedLine !== null) return null;
    matchedLine = index + 1;
  }
  return matchedLine === null ? null : { startLine: matchedLine, endLine: matchedLine };
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
    }),
    text: input.text.trim(),
    diff: input.quote.text,
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
    quote: input.quote,
  };
}

export function matchesFileReviewComment(
  comment: ReviewCommentContext,
  contents: string,
): boolean {
  const lines = contents.split("\n");
  const slice = lines.slice(comment.startIndex, comment.endIndex + 1).join("\n");
  if (!comment.quote) {
    return slice === comment.diff;
  }
  if (slice.includes(comment.quote.text)) return true;
  return (
    findAssistantCitationText(slice, {
      ...comment.quote,
      start: 0,
      end: 0,
    }) !== null || findAssistantCitationText(contents, comment.quote) !== null
  );
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
  const probe = node.ownerDocument.createRange();
  probe.setStart(node, offset);
  if (side === "start") {
    const near = rows.find((candidate) => probe.comparePoint(candidate, 0) >= 0);
    if (!near) return null;
    const line = Number(near.dataset.line);
    return Number.isFinite(line) && line >= 1 ? { line, column: 0 } : null;
  }
  const near = rows.findLast((candidate) => probe.comparePoint(candidate, candidate.childNodes.length) <= 0);
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
  readonly quote: FileTextQuote;
  readonly rect: DOMRect;
  readonly lastRect: DOMRect;
} | null {
  if (!selection || selection.isCollapsed) return null;
  let staticRange: StaticRange | undefined;
  try {
    staticRange = selection.getComposedRanges({ shadowRoots: [shadowRoot] })[0];
  } catch {
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

function resolveShadowQuoteRange(
  shadowRoot: ShadowRoot,
  contents: string,
  quote: FileTextQuote,
  lineHint?: { readonly startIndex: number; readonly endIndex: number },
): Range | null {
  const starts = lineStartsOf(contents);
  let rawStart: number | null = null;
  let rawEnd: number | null = null;

  const fullMatch = findAssistantCitationText(contents, quote);
  if (fullMatch !== null) {
    rawStart = rawTextOffset(contents, fullMatch.start);
    rawEnd = rawTextOffset(contents, fullMatch.end);
  } else if (lineHint) {
    const lines = contents.split(/\r\n|\r|\n/);
    const slice = lines.slice(lineHint.startIndex, lineHint.endIndex + 1).join("\n");
    const sliceMatch = findAssistantCitationText(slice, { ...quote, start: 0, end: 0 });
    if (sliceMatch !== null) {
      const baseOffset = starts[lineHint.startIndex] ?? 0;
      rawStart = baseOffset + rawTextOffset(slice, sliceMatch.start);
      rawEnd = baseOffset + rawTextOffset(slice, sliceMatch.end);
    }
  }
  if (rawStart === null || rawEnd === null || rawEnd <= rawStart) return null;

  const startLine = lineIndexAtOffset(starts, rawStart) + 1;
  const startColumn = rawStart - (starts[startLine - 1] ?? 0);
  const endLine = lineIndexAtOffset(starts, Math.max(rawStart, rawEnd - 1)) + 1;
  const endColumn = rawEnd - (starts[endLine - 1] ?? 0);

  const rows = [...shadowRoot.querySelectorAll<HTMLElement>("[data-line]")];
  if (rows.length === 0) return null;
  const firstMountedLine = Number(rows[0]!.dataset.line);
  const lastMountedLine = Number(rows[rows.length - 1]!.dataset.line);
  if (endLine < firstMountedLine || startLine > lastMountedLine) return null;

  const clampedStartLine = Math.max(startLine, firstMountedLine);
  const clampedStartCol = clampedStartLine === startLine ? startColumn : 0;
  const clampedEndLine = Math.min(endLine, lastMountedLine);
  const startRow = shadowRoot.querySelector<HTMLElement>(`[data-line="${clampedStartLine}"]`);
  const endRow = shadowRoot.querySelector<HTMLElement>(`[data-line="${clampedEndLine}"]`);
  if (!startRow || !endRow) return null;

  const clampedEndCol =
    clampedEndLine === endLine
      ? endColumn
      : Math.max(0, lineEndOf(contents, starts, clampedEndLine - 1) - (starts[clampedEndLine - 1] ?? 0));

  const startPoint = pointWithinShadowRow(startRow, clampedStartCol);
  const endPoint = pointWithinShadowRow(endRow, clampedEndCol);
  const range = shadowRoot.ownerDocument.createRange();
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
  readonly draft?: { readonly startLine: number; readonly endLine: number; readonly quote: FileTextQuote } | null | undefined;
}): void {
  const { surfaceKey, shadowRoot, contents, comments, draft } = input;
  if (!shadowRoot) {
    clearShadowSourceSublineHighlights(surfaceKey);
    return;
  }
  const commentRanges: Range[] = [];
  for (const comment of comments) {
    if (!comment.quote) continue;
    const range = resolveShadowQuoteRange(shadowRoot, contents, comment.quote, {
      startIndex: comment.startIndex,
      endIndex: comment.endIndex,
    });
    if (range) commentRanges.push(range);
  }
  const draftRanges: Range[] = [];
  if (draft) {
    const range = resolveShadowQuoteRange(shadowRoot, contents, draft.quote, {
      startIndex: draft.startLine - 1,
      endIndex: draft.endLine - 1,
    });
    if (range) draftRanges.push(range);
  }
  if (commentRanges.length === 0 && draftRanges.length === 0) {
    sourceHighlightSurfaceRanges.delete(surfaceKey);
  } else {
    sourceHighlightSurfaceRanges.set(surfaceKey, { comments: commentRanges, drafts: draftRanges });
  }
  rebuildSourceHighlights();
}

export function clearShadowSourceSublineHighlights(surfaceKey: string): void {
  if (sourceHighlightSurfaceRanges.delete(surfaceKey)) {
    rebuildSourceHighlights();
  }
}

export function initialEditableFileAnnotations(
  comments: ReadonlyArray<ReviewCommentContext>,
  filePath: string,
  contents: string,
): FileCommentLineAnnotation[] {
  const sectionId = rawFileSectionId(filePath);
  const annotations: FileCommentLineAnnotation[] = [];
  for (const comment of comments) {
    if (comment.sectionId !== sectionId) continue;
    if (!matchesFileReviewComment(comment, contents)) continue;
    const lineNumber = comment.endIndex + 1;
    const entry: FileCommentAnnotationEntry = {
      id: comment.id,
      kind: "comment",
      startLine: comment.startIndex + 1,
      endLine: lineNumber,
      text: comment.text,
    };
    const existing = annotations.find((item) => item.lineNumber === lineNumber);
    if (existing) existing.metadata.entries.push(entry);
    else annotations.push({ lineNumber, metadata: { entries: [entry] } });
  }
  return annotations;
}

export function useForkSublineQuotes(comments: ReadonlyArray<ReviewCommentContext>) {
  const [quotesByEntryId, setQuotesByEntryId] = useState<ReadonlyMap<string, FileTextQuote>>(
    () => new Map(),
  );

  const registerQuote = (entryId: string, quote: FileTextQuote) => {
    setQuotesByEntryId((current) => {
      const next = new Map(current);
      next.set(entryId, quote);
      return next;
    });
  };

  const clearQuote = (entryId: string) => {
    setQuotesByEntryId((current) => {
      if (!current.has(entryId)) return current;
      const next = new Map(current);
      next.delete(entryId);
      return next;
    });
  };

  const quoteOf = (entryId: string): FileTextQuote | undefined =>
    quotesByEntryId.get(entryId) ?? comments.find((comment) => comment.id === entryId)?.quote;

  const formatEntryRangeLabel = (
    entry: Pick<FileCommentAnnotationEntry, "id" | "startLine" | "endLine">,
    resolve?: Parameters<typeof formatFileCommentRange>[2],
  ): string => {
    const quote = quoteOf(entry.id);
    if (quote) {
      return formatQuotedRangeLabel({
        startLine: entry.startLine,
        endLine: entry.endLine,
        quoteText: quote.text,
      });
    }
    return formatFileCommentRange(entry.startLine, entry.endLine, resolve);
  };

  return {
    registerQuote,
    clearQuote,
    quoteOf,
    formatEntryRangeLabel,
  };
}

export function buildEditableReviewComment(input: {
  readonly id: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly contents: string;
  readonly quote?: FileTextQuote | undefined;
}): ReviewCommentContext {
  if (input.quote) {
    return buildSublineFileReviewComment({
      id: input.id,
      filePath: input.filePath,
      sectionKind: "file",
      text: input.text,
      quote: input.quote,
      contents: input.contents,
      startLine: input.startLine,
      endLine: input.endLine,
    });
  }
  return buildFileReviewComment(input);
}

export function useForkEditableSourceHighlights(input: {
  readonly surfaceKey: string;
  readonly surfaceEl: HTMLElement | null;
  readonly contents: string;
  readonly comments: ReadonlyArray<ReviewCommentContext>;
  readonly lineAnnotations: ReadonlyArray<FileCommentLineAnnotation>;
  readonly quoteOf: (entryId: string) => FileTextQuote | undefined;
}) {
  const draftEntry = input.lineAnnotations
    .flatMap((annotation) => annotation.metadata.entries)
    .find((entry) => entry.kind === "draft");
  const draftStartLine = draftEntry?.startLine;
  const draftEndLine = draftEntry?.endLine;
  const draftQuote = draftEntry ? input.quoteOf(draftEntry.id) : undefined;

  const sync = (shadowRoot: ShadowRoot | null | undefined) => {
    syncShadowSourceSublineHighlights({
      surfaceKey: input.surfaceKey,
      shadowRoot,
      contents: input.contents,
      comments: input.comments,
      draft:
        draftStartLine !== undefined && draftEndLine !== undefined && draftQuote
          ? { startLine: draftStartLine, endLine: draftEndLine, quote: draftQuote }
          : null,
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs CSS Highlights in the editable diffs shadow DOM for saved and draft subline comments
  useEffect(() => {
    syncShadowSourceSublineHighlights({
      surfaceKey: input.surfaceKey,
      shadowRoot: input.surfaceEl?.querySelector("diffs-container")?.shadowRoot,
      contents: input.contents,
      comments: input.comments,
      draft:
        draftStartLine !== undefined && draftEndLine !== undefined && draftQuote
          ? { startLine: draftStartLine, endLine: draftEndLine, quote: draftQuote }
          : null,
    });
    return () => clearShadowSourceSublineHighlights(input.surfaceKey);
  }, [draftEndLine, draftQuote, draftStartLine, input.comments, input.contents, input.surfaceEl, input.surfaceKey]);

  return sync;
}
