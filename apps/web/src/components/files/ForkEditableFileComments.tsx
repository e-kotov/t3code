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
  carryQuotedFileComment,
  clearShadowSourceSublineHighlights,
  FORK_SOURCE_SUBLINE_UNSAFE_CSS,
  type FileTextChange,
  fileReviewCommentsFor,
  formatQuotedRangeLabel,
  quoteSubmittedFileComment,
  type SourceSelection,
  syncShadowSourceSublineHighlights,
  withPromptCommentAnnotations,
} from "./forkFileSublineComments";
import { ForkSourceSelectionToolbar, ForkSublineQuoteBadge } from "./ForkSourceSelectionToolbar";

const EMPTY_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function usePromptReviewComments(composerDraftTarget: ScopedThreadRef | DraftId) {
  return useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_COMMENTS,
  );
}

/** Prompt comments that still apply to this raw file, with quotes recovered from records. */
export function useForkFileReviewComments(
  composerDraftTarget: ScopedThreadRef | DraftId,
  filePath: string,
  contents: string,
): ReviewCommentContext[] {
  return fileReviewCommentsFor(usePromptReviewComments(composerDraftTarget), filePath, contents);
}

function draftSelectionOf(
  lineAnnotations: ReadonlyArray<FileCommentLineAnnotation>,
  stagedSelections: ReadonlyMap<string, SourceSelection>,
) {
  const draft = lineAnnotations
    .flatMap((annotation) => annotation.metadata.entries)
    .find((entry) => entry.kind === "draft");
  return (draft && stagedSelections.get(draft.id)) ?? null;
}

type EditEvent = { readonly changes: ReadonlyArray<FileTextChange> };

function handleWithChanges<Event extends EditEvent>(
  changesRef: { current: ReadonlyArray<FileTextChange> | null },
  handler: (event: Event) => void,
  event: Event,
) {
  changesRef.current = event.changes;
  try {
    handler(event);
  } finally {
    changesRef.current = null;
  }
}

/** Subline quote state and line annotations for the editable file surface. */
export function useForkEditableFileComments(
  composerDraftTarget: ScopedThreadRef | DraftId,
  relativePath: string,
  contents: string,
) {
  const surfaceKey = useId();
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const promptComments = usePromptReviewComments(composerDraftTarget);
  const comments = fileReviewCommentsFor(promptComments, relativePath, contents);
  const [annotationState, setLineAnnotations] = useState<FileCommentLineAnnotation[]>(() =>
    withPromptCommentAnnotations([], comments),
  );
  // Comments added while open (context import) are annotated too, until an edit stores them.
  const lineAnnotations = withPromptCommentAnnotations(annotationState, comments);
  const [stagedSelections, setStagedSelections] = useState<ReadonlyMap<string, SourceSelection>>(
    () => new Map(),
  );
  const pendingSelectionRef = useRef<SourceSelection | null>(null);
  const editChangesRef = useRef<ReadonlyArray<FileTextChange> | null>(null);
  const inPrompt = (entryId: string) => promptComments.some((comment) => comment.id === entryId);
  // A staged selection serves only the draft; once in the prompt, the resolved comment decides.
  const quoteOf = (entryId: string) =>
    inPrompt(entryId)
      ? comments.find((comment) => comment.id === entryId)?.quote
      : stagedSelections.get(entryId)?.quote;

  return {
    surfaceKey,
    contents,
    comments,
    quoteOf,
    stagedSelections,
    unsafeCSS: FORK_SOURCE_SUBLINE_UNSAFE_CSS,
    lineAnnotationState: [lineAnnotations, setLineAnnotations] as const,
    /** Exposes the changes of each editor event to the comments its handler rebuilds. */
    trackEdit:
      <Event extends EditEvent>(handler: (event: Event) => void) =>
      (event: Event) =>
        handleWithChanges(editChangesRef, handler, event),
    /**
     * Quotes the line comments the editable surface builds: a submitted draft from its captured
     * selection, an edited comment only when the edit left its quoted lines untouched.
     */
    addReviewComment: (...[target, comment, options]: Parameters<typeof addReviewComment>) => {
      let next = comment;
      // The stored record, not this render's, holds the lines before the change being handled.
      const stored = useComposerDraftStore
        .getState()
        .getComposerDraft(target)
        ?.reviewComments.find((candidate) => candidate.id === comment.id);
      if (stored) {
        // A restored record keeps the quote this render recovered, so it is not rebuilt per render.
        const quote = stored.quote ?? comments.find(({ id }) => id === comment.id)?.quote;
        const previous = quote ? { ...stored, quote } : stored;
        next = carryQuotedFileComment(previous, editChangesRef.current ?? [], comment);
      } else {
        const selection = stagedSelections.get(comment.id);
        if (selection) next = quoteSubmittedFileComment(comment, selection, contents);
      }
      addReviewComment(target, next, options);
    },
    /** Attaches the selection staged by the selection toolbar, if any, to a new entry id. */
    claimQuote: (id: string) => {
      const selection = pendingSelectionRef.current;
      pendingSelectionRef.current = null;
      if (selection) setStagedSelections((current) => new Map(current).set(id, selection));
      return id;
    },
    stageSelection: (selection: SourceSelection) => {
      pendingSelectionRef.current = selection;
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
        draft: draftSelectionOf(lineAnnotations, stagedSelections),
      });
    },
  };
}

/** Selection toolbar and comment highlights, mounted inside the editable surface element. */
export function ForkEditableSourceComments({
  comments,
  disabled,
  onComment,
}: {
  readonly comments: ReturnType<typeof useForkEditableFileComments>;
  readonly disabled: boolean;
  readonly onComment: (range: SelectedLineRange) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const surfaceEl = anchor?.parentElement ?? null;
  const { surfaceKey, contents, comments: fileComments, stageSelection } = comments;
  const draft = draftSelectionOf(comments.lineAnnotationState[0], comments.stagedSelections);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs CSS Highlights in the editable diffs shadow DOM for saved and draft subline comments
  useEffect(() => {
    syncShadowSourceSublineHighlights({
      surfaceKey,
      shadowRoot: surfaceEl?.querySelector("diffs-container")?.shadowRoot,
      contents,
      comments: fileComments,
      draft,
    });
    return () => clearShadowSourceSublineHighlights(surfaceKey);
  }, [contents, draft, fileComments, surfaceEl, surfaceKey]);

  return (
    <>
      <span ref={setAnchor} hidden />
      <ForkSourceSelectionToolbar
        surfaceEl={surfaceEl}
        portalTarget={surfaceEl}
        contents={contents}
        disabled={disabled}
        onComment={(selection) => {
          stageSelection(selection);
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
