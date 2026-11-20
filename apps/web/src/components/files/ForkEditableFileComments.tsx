import type { SelectedLineRange } from "@pierre/diffs";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";

import { DiffCommentAnnotation } from "~/components/diffs/DiffCommentAnnotation";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import type {
  FileCommentAnnotationEntry,
  FileCommentLineAnnotation,
} from "./fileCommentAnnotations";
import {
  clearShadowSourceSublineHighlights,
  fileReviewCommentsFor,
  formatQuotedRangeLabel,
  initialEditableFileAnnotations,
  quoteFileReviewComment,
  syncShadowSourceSublineHighlights,
} from "./forkFileSublineComments";
import type { FileTextQuote } from "./forkFileTextQuote";
import { ForkSourceSelectionToolbar, ForkSublineQuoteBadge } from "./ForkSourceSelectionToolbar";

export { FORK_SOURCE_SUBLINE_UNSAFE_CSS } from "./forkFileSublineComments";

const EMPTY_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

/** Prompt comments that still apply to this raw file, with quotes recovered from records. */
export function useForkFileReviewComments(
  composerDraftTarget: ScopedThreadRef | DraftId,
  filePath: string,
  contents: string,
): ReviewCommentContext[] {
  const comments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_COMMENTS,
  );
  return fileReviewCommentsFor(comments, filePath, contents);
}

function draftQuoteOf(
  lineAnnotations: ReadonlyArray<FileCommentLineAnnotation>,
  quoteOf: (entryId: string) => FileTextQuote | undefined,
) {
  const draft = lineAnnotations
    .flatMap((annotation) => annotation.metadata.entries)
    .find((entry) => entry.kind === "draft");
  const quote = draft ? quoteOf(draft.id) : undefined;
  return draft && quote ? { startLine: draft.startLine, endLine: draft.endLine, quote } : null;
}

/** Subline quote state for the editable file surface; the surface keeps its line annotations. */
export function useForkEditableFileComments(
  composerDraftTarget: ScopedThreadRef | DraftId,
  relativePath: string,
  contents: string,
) {
  const surfaceKey = useId();
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const comments = useForkFileReviewComments(composerDraftTarget, relativePath, contents);
  const [stagedQuotes, setStagedQuotes] = useState<ReadonlyMap<string, FileTextQuote>>(
    () => new Map(),
  );
  const pendingQuoteRef = useRef<FileTextQuote | null>(null);
  const quoteOf = (entryId: string) =>
    stagedQuotes.get(entryId) ?? comments.find((comment) => comment.id === entryId)?.quote;

  return {
    surfaceKey,
    contents,
    comments,
    quoteOf,
    initialLineAnnotations: () => initialEditableFileAnnotations(comments),
    addReviewComment: (...[target, comment, options]: Parameters<typeof addReviewComment>) => {
      const quote = quoteOf(comment.id);
      addReviewComment(target, quote ? quoteFileReviewComment(comment, quote) : comment, options);
    },
    /** Attaches the quote staged by the selection toolbar, if any, to a new entry id. */
    claimQuote: (id: string) => {
      const quote = pendingQuoteRef.current;
      pendingQuoteRef.current = null;
      if (quote) setStagedQuotes((current) => new Map(current).set(id, quote));
      return id;
    },
    stageQuote: (quote: FileTextQuote) => {
      pendingQuoteRef.current = quote;
    },
    quoteFor: (entry: Pick<FileCommentAnnotationEntry, "id" | "startLine" | "endLine">) => {
      const quote = quoteOf(entry.id);
      if (!quote) return undefined;
      const { startLine, endLine } = entry;
      return {
        text: quote.text,
        rangeLabel: formatQuotedRangeLabel({ quoteText: quote.text, startLine, endLine }),
      };
    },
    onPostRender: (
      fileContainer: HTMLElement,
      phase: string,
      lineAnnotations: ReadonlyArray<FileCommentLineAnnotation>,
    ) => {
      if (phase === "unmount") return;
      syncShadowSourceSublineHighlights({
        surfaceKey,
        shadowRoot: fileContainer.shadowRoot,
        contents,
        comments,
        draft: draftQuoteOf(lineAnnotations, quoteOf),
      });
    },
  };
}

/** Selection toolbar and comment highlights, mounted inside the editable surface element. */
export function ForkEditableSourceComments({
  comments,
  lineAnnotations,
  disabled,
  onComment,
}: {
  readonly comments: ReturnType<typeof useForkEditableFileComments>;
  readonly lineAnnotations: ReadonlyArray<FileCommentLineAnnotation>;
  readonly disabled: boolean;
  readonly onComment: (range: SelectedLineRange) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const surfaceEl = anchor?.parentElement ?? null;
  const { surfaceKey, contents, comments: fileComments, stageQuote } = comments;
  const draft = draftQuoteOf(lineAnnotations, comments.quoteOf);
  const draftStartLine = draft?.startLine;
  const draftEndLine = draft?.endLine;
  const draftQuote = draft?.quote;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs CSS Highlights in the editable diffs shadow DOM for saved and draft subline comments
  useEffect(() => {
    syncShadowSourceSublineHighlights({
      surfaceKey,
      shadowRoot: surfaceEl?.querySelector("diffs-container")?.shadowRoot,
      contents,
      comments: fileComments,
      draft:
        draftStartLine !== undefined && draftEndLine !== undefined && draftQuote
          ? { startLine: draftStartLine, endLine: draftEndLine, quote: draftQuote }
          : null,
    });
    return () => clearShadowSourceSublineHighlights(surfaceKey);
  }, [contents, draftEndLine, draftQuote, draftStartLine, fileComments, surfaceEl, surfaceKey]);

  return (
    <>
      <span ref={setAnchor} hidden />
      <ForkSourceSelectionToolbar
        surfaceEl={surfaceEl}
        portalTarget={surfaceEl}
        contents={contents}
        disabled={disabled}
        onComment={(selection) => {
          stageQuote(selection.quote);
          onComment({ start: selection.startLine, end: selection.endLine });
        }}
      />
    </>
  );
}

export function ForkQuotedCommentAnnotation({
  quote,
  rangeLabel,
  ...props
}: ComponentProps<typeof DiffCommentAnnotation> & {
  readonly quote: { readonly text: string; readonly rangeLabel: string } | undefined;
}) {
  return (
    <>
      {quote ? <ForkSublineQuoteBadge text={quote.text} /> : null}
      <DiffCommentAnnotation {...props} rangeLabel={quote?.rangeLabel ?? rangeLabel} />
    </>
  );
}
