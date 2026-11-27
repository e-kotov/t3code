import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { splitMarkdown } from "@t3tools/shared/markdownChunks";
import { useGT } from "gt-react";
import { MessageCircle, QuoteIcon, X } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEventHandler,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { DiffCommentAnnotation } from "~/components/diffs/DiffCommentAnnotation";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { observeResize } from "~/lib/observeResize";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { ChunkedMarkdown } from "./ChunkedMarkdown";
import { FileMarkdownPreview } from "./FileMarkdownPreview";
import { nextFileCommentId } from "./fileCommentAnnotations";
import {
  FILE_TEXT_QUOTE_MAX_LENGTH,
  MARKDOWN_COMMENT_ACTIVE_HIGHLIGHT_NAME,
  MARKDOWN_COMMENT_DRAFT_HIGHLIGHT_NAME,
  MARKDOWN_COMMENT_HIGHLIGHT_NAME,
  buildSublineFileReviewComment,
  captureContainerTextSelection,
  formatQuotedRangeLabel,
  inferMarkdownSourceLineRange,
  renderedMarkdownCommentsFor,
  resolveContainerTextQuoteRange,
} from "./forkFileSublineComments";
import type { FileTextQuote } from "./forkFileTextQuote";
import { ForkSublineQuoteBadge } from "./ForkSourceSelectionToolbar";
import "./forkMarkdownComments.css";

const EMPTY_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

type MarkdownCommentPopoverState =
  | {
      readonly kind: "draft";
      readonly id: string;
      readonly quote: FileTextQuote;
      readonly startLine: number | undefined;
      readonly endLine: number | undefined;
      readonly rangeLabel: string;
      readonly text: string;
    }
  | {
      readonly kind: "comment";
      readonly commentId: string;
    };

function removeOwnedRanges(
  registry: typeof CSS.highlights | undefined,
  highlightName: string,
  owned: Set<Range>,
) {
  if (!registry || owned.size === 0) {
    owned.clear();
    return;
  }
  const existing = registry.get(highlightName);
  if (existing) {
    for (const range of owned) existing.delete(range);
    if (existing.size === 0) registry.delete(highlightName);
  }
  owned.clear();
}

function addOwnedRanges(
  registry: typeof CSS.highlights | undefined,
  highlightName: string,
  owned: Set<Range>,
  ranges: readonly Range[],
) {
  removeOwnedRanges(registry, highlightName, owned);
  if (!registry || typeof Highlight === "undefined" || ranges.length === 0) return;
  const highlight = registry.get(highlightName) ?? new Highlight();
  for (const range of ranges) {
    highlight.add(range);
    owned.add(range);
  }
  registry.set(highlightName, highlight);
}

function positionPopoverNearAnchor(popover: HTMLElement, anchorRect: DOMRect) {
  const popoverRect = popover.getBoundingClientRect();
  const width = Math.max(popoverRect.width, 280);
  const height = Math.max(popoverRect.height, 110);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  const belowTop = anchorRect.bottom + 8;
  const aboveTop = anchorRect.top - height - 8;
  const fitsBelow = belowTop + height <= window.innerHeight - 8;
  const fitsAbove = aboveTop >= 8;
  const rawTop = fitsBelow || !fitsAbove ? belowTop : aboveTop;
  const top = Math.max(8, Math.min(rawTop, window.innerHeight - height - 8));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = "visible";
}

function useRenderedMarkdownComments(
  composerDraftTarget: ScopedThreadRef | DraftId,
  relativePath: string,
): ReviewCommentContext[] {
  const comments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_COMMENTS,
  );
  return renderedMarkdownCommentsFor(comments, relativePath);
}

function ForkCommentableMarkdownPreview({
  commentTarget,
  ...previewProps
}: ComponentProps<typeof FileMarkdownPreview> & {
  readonly commentTarget: {
    readonly environmentId: EnvironmentId;
    readonly projectId?: ProjectId | undefined;
    readonly composerDraftTarget: ScopedThreadRef | DraftId;
  };
}) {
  const { environmentId, projectId, composerDraftTarget } = commentTarget;
  const { relativePath, text: contents } = previewProps;
  const gt = useGT();
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const comments = useRenderedMarkdownComments(composerDraftTarget, relativePath);

  const [surfaceEl, setSurfaceEl] = useState<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{
    readonly quote: FileTextQuote;
    readonly position: SelectionActionPoint;
  } | null>(null);
  const [activePopover, setActivePopover] = useState<MarkdownCommentPopoverState | null>(null);

  const toolbarRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  const inspectedComment =
    activePopover?.kind === "comment"
      ? (comments.find((comment) => comment.id === activePopover.commentId) ?? null)
      : null;
  const inspectedCommentId = inspectedComment?.id ?? null;
  const activeDraft = activePopover?.kind === "draft" ? activePopover : null;
  const activeDraftQuote = activeDraft?.quote ?? null;
  const activeQuote = activeDraftQuote ?? inspectedComment?.quote ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clamps the floating selection toolbar inside the window bounds before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes rendered markdown text selections and scroll/escape dismissal
  useEffect(() => {
    if (!surfaceEl) return;
    const scrollContainer =
      surfaceEl.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ??
      surfaceEl.parentElement ??
      surfaceEl;

    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const captured = captureContainerTextSelection(surfaceEl, window.getSelection());
      if (!captured) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const bounds = scrollContainer.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [bounds])) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        quote: captured.quote,
        position: resolveSelectionActionPosition({
          bounds,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };

    const actions = observeSelectionActions({
      element: surfaceEl,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [surfaceEl]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes CSS Highlights and popover coordinates with rendered markdown DOM geometry
  useEffect(() => {
    if (!surfaceEl) return;
    const scrollContainer =
      surfaceEl.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ??
      surfaceEl.parentElement ??
      surfaceEl;
    const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
    const ownedSaved = new Set<Range>();
    const ownedActive = new Set<Range>();
    const ownedDraft = new Set<Range>();
    let anchorRange: Range | null = null;
    let rangesStale = true;
    let frame: number | null = null;

    // Finding quotes walks the whole document, so only DOM or comment changes re-resolve them.
    // Highlight ranges are live and follow layout; scroll and resize only move the popover.
    const resolveRanges = () => {
      const savedRanges: Range[] = [];
      const activeRanges: Range[] = [];
      const draftRanges: Range[] = [];
      for (const comment of comments) {
        if (!comment.quote) continue;
        const range = resolveContainerTextQuoteRange(surfaceEl, comment.quote);
        if (!range) continue;
        if (inspectedCommentId === comment.id) activeRanges.push(range);
        else savedRanges.push(range);
      }
      if (activeDraftQuote) {
        const range = resolveContainerTextQuoteRange(surfaceEl, activeDraftQuote);
        if (range) draftRanges.push(range);
      }
      addOwnedRanges(registry, MARKDOWN_COMMENT_HIGHLIGHT_NAME, ownedSaved, savedRanges);
      addOwnedRanges(registry, MARKDOWN_COMMENT_ACTIVE_HIGHLIGHT_NAME, ownedActive, activeRanges);
      addOwnedRanges(registry, MARKDOWN_COMMENT_DRAFT_HIGHLIGHT_NAME, ownedDraft, draftRanges);
      anchorRange = (activeDraftQuote ? draftRanges[0] : activeRanges[0]) ?? null;
    };

    const sync = () => {
      frame = null;
      if (!surfaceEl.isConnected) return;
      if (rangesStale) {
        rangesStale = false;
        resolveRanges();
      }
      const popover = popoverRef.current;
      if (popover && (activeDraftQuote || inspectedCommentId !== null)) {
        const anchorRect =
          anchorRange?.getBoundingClientRect() ?? scrollContainer.getBoundingClientRect();
        positionPopoverNearAnchor(popover, anchorRect);
      }
    };

    const scheduleSync = (staleRanges: boolean) => {
      if (staleRanges) rangesStale = true;
      if (frame === null) frame = requestAnimationFrame(sync);
    };
    const resync = () => scheduleSync(true);
    const reposition = () => scheduleSync(false);

    const observer = new MutationObserver(resync);
    observer.observe(surfaceEl, { childList: true, characterData: true, subtree: true });
    const stopResize = observeResize([surfaceEl, scrollContainer], reposition);
    scrollContainer.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    sync();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      stopResize();
      scrollContainer.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
      removeOwnedRanges(registry, MARKDOWN_COMMENT_HIGHLIGHT_NAME, ownedSaved);
      removeOwnedRanges(registry, MARKDOWN_COMMENT_ACTIVE_HIGHLIGHT_NAME, ownedActive);
      removeOwnedRanges(registry, MARKDOWN_COMMENT_DRAFT_HIGHLIGHT_NAME, ownedDraft);
    };
  }, [activeDraftQuote, comments, inspectedCommentId, surfaceEl]);

  const popoverOpen = activeDraft !== null || inspectedComment !== null;
  const draftIsEmpty = activeDraft !== null && activeDraft.text.trim().length === 0;
  const popoverKind = activeDraft ? "draft" : inspectedComment ? "comment" : null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- dismisses open comment popovers on outside click or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || toolbarRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-file-comment-ui]")) return;
      if (popoverKind === "comment" || draftIsEmpty) {
        setActivePopover(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (popoverKind === "comment" || draftIsEmpty) {
        setActivePopover(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [draftIsEmpty, popoverKind, popoverOpen]);

  const beginDraftFromSelection = (quote: FileTextQuote) => {
    const inferred = inferMarkdownSourceLineRange(contents, quote);
    setActivePopover({
      kind: "draft",
      id: nextFileCommentId(),
      quote,
      startLine: inferred?.startLine,
      endLine: inferred?.endLine,
      rangeLabel: formatQuotedRangeLabel({
        quoteText: quote.text,
        startLine: inferred?.startLine,
        endLine: inferred?.endLine,
      }),
      text: "",
    });
  };

  const focusComment = (comment: ReviewCommentContext) => {
    setActivePopover({ kind: "comment", commentId: comment.id });
    if (!surfaceEl || !comment.quote) return;
    const range = resolveContainerTextQuoteRange(surfaceEl, comment.quote);
    if (!range) return;
    const scrollContainer =
      surfaceEl.closest<HTMLElement>("[data-slot='scroll-area-viewport']") ??
      surfaceEl.parentElement;
    if (!scrollContainer) return;
    const rect = range.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    if (rect.top < containerRect.top + 16 || rect.bottom > containerRect.bottom - 16) {
      const nextTop =
        scrollContainer.scrollTop + (rect.top - containerRect.top) - containerRect.height / 3;
      scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    }
  };

  const handleSurfaceClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!surfaceEl) return;
    const nativeSelection = window.getSelection();
    if (nativeSelection && !nativeSelection.isCollapsed) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        "a, button, input, textarea, select, [role='button'], [data-file-comment-ui]",
      )
    ) {
      return;
    }
    for (const comment of comments) {
      if (!comment.quote) continue;
      const range = resolveContainerTextQuoteRange(surfaceEl, comment.quote);
      if (!range) continue;
      const hit = Array.from(range.getClientRects()).some(
        (rect) =>
          event.clientX >= rect.left - 2 &&
          event.clientX <= rect.right + 2 &&
          event.clientY >= rect.top - 2 &&
          event.clientY <= rect.bottom + 2,
      );
      if (hit) {
        setActivePopover({ kind: "comment", commentId: comment.id });
        return;
      }
    }
  };

  const tooLong = (selection?.quote.text.length ?? 0) > FILE_TEXT_QUOTE_MAX_LENGTH;

  return (
    <div
      ref={setSurfaceEl}
      data-markdown-comment-surface
      className="relative"
      onClick={handleSurfaceClick}
    >
      {comments.length > 0 ? (
        <div
          data-file-comment-ui
          className="mx-auto flex max-w-4xl flex-wrap items-center gap-1.5 px-6 pt-4"
        >
          <span className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
            <MessageCircle className="size-3 text-primary/70" aria-hidden="true" />
            {gt("{count, plural, one {{count} comment} other {{count} comments}}", {
              count: comments.length,
            })}
          </span>
          {comments.map((comment) => {
            const active = inspectedComment?.id === comment.id;
            return (
              <button
                key={comment.id}
                type="button"
                data-file-comment-ui
                onClick={() => focusComment(comment)}
                className={
                  active
                    ? "inline-flex max-w-60 items-center gap-1 truncate rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-2xs text-foreground"
                    : "inline-flex max-w-60 items-center gap-1 truncate rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }
              >
                <span className="truncate">{comment.rangeLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <FileMarkdownPreview {...previewProps} />

      {selection
        ? createPortal(
            <Button
              ref={toolbarRef}
              type="button"
              size="xs"
              variant="glass"
              disabled={tooLong}
              data-file-comment-ui
              aria-label={tooLong ? gt("Shorten selection") : gt("Add a comment")}
              className="fixed z-50 max-w-[calc(100vw-1rem)]"
              style={{ left: selection.position.x, top: selection.position.y }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (tooLong) return;
                const quote = selection.quote;
                window.getSelection()?.removeAllRanges();
                actionsRef.current?.cancel();
                setSelection(null);
                beginDraftFromSelection(quote);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  actionsRef.current?.cancel();
                  setSelection(null);
                }
              }}
            >
              <QuoteIcon aria-hidden="true" className="size-3.5" />
              {tooLong
                ? gt("Shorten selection")
                : gt("Comment", { $context: "verb, submit button" })}
            </Button>,
            document.body,
          )
        : null}

      {activeDraft || inspectedComment
        ? createPortal(
            <div
              ref={popoverRef}
              data-file-comment-ui
              data-diff-comment-annotation
              style={{ visibility: "hidden", left: 8, top: 8 }}
              className="fixed z-50 w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-2xs text-muted-foreground">
                <span className="truncate font-medium">
                  {activeDraft ? activeDraft.rangeLabel : inspectedComment!.rangeLabel}
                </span>
                {inspectedComment ? (
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={gt("Close")}
                    onClick={() => setActivePopover(null)}
                  >
                    <X className="size-3" />
                  </Button>
                ) : null}
              </div>
              {activeQuote ? <ForkSublineQuoteBadge text={activeQuote.text} /> : null}
              {activeDraft ? (
                <DiffCommentAnnotation
                  environmentId={environmentId}
                  projectId={projectId}
                  ownerKey={JSON.stringify([composerDraftTarget, relativePath, activeDraft.id])}
                  kind="draft"
                  rangeLabel={activeDraft.rangeLabel}
                  text={activeDraft.text}
                  onTextChange={(nextText) =>
                    setActivePopover((current) =>
                      current?.kind === "draft" && current.id === activeDraft.id
                        ? { ...current, text: nextText }
                        : current,
                    )
                  }
                  onCancel={() => setActivePopover(null)}
                  onComment={(submittedText) => {
                    addReviewComment(
                      composerDraftTarget,
                      buildSublineFileReviewComment({
                        id: activeDraft.id,
                        filePath: relativePath,
                        sectionKind: "file-rendered",
                        text: submittedText,
                        quote: activeDraft.quote,
                        contents,
                        startLine: activeDraft.startLine,
                        endLine: activeDraft.endLine,
                      }),
                    );
                    setActivePopover(null);
                  }}
                />
              ) : inspectedComment ? (
                <DiffCommentAnnotation
                  environmentId={environmentId}
                  projectId={projectId}
                  ownerKey={JSON.stringify([
                    composerDraftTarget,
                    relativePath,
                    inspectedComment.id,
                  ])}
                  kind="comment"
                  rangeLabel={inspectedComment.rangeLabel}
                  text={inspectedComment.text}
                  onCancel={() => setActivePopover(null)}
                  onComment={() => {}}
                  onDelete={() => {
                    removeReviewComment(composerDraftTarget, inspectedComment.id);
                    setActivePopover(null);
                  }}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const savedCommentableMarkdownScroll = new Map<string, number>();
const MAX_SAVED_COMMENTABLE_SCROLL = 100;

type WorkspaceMarkdownProps = ComponentProps<typeof ForkCommentableMarkdownPreview> & {
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

function ScrollableCommentableMarkdown({ onKeyDown, ...previewProps }: WorkspaceMarkdownProps) {
  const { text, threadRef, cwd, relativePath } = previewProps;
  const positionKey = JSON.stringify([
    threadRef.environmentId,
    threadRef.threadId,
    cwd,
    relativePath,
  ]);
  const root = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores a DOM scrollbar on file or thread change
  useLayoutEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
    if (!viewport) return;
    viewport.scrollTop = savedCommentableMarkdownScroll.get(positionKey) ?? 0;
    const save = () => {
      savedCommentableMarkdownScroll.delete(positionKey);
      savedCommentableMarkdownScroll.set(positionKey, viewport.scrollTop);
      if (savedCommentableMarkdownScroll.size > MAX_SAVED_COMMENTABLE_SCROLL) {
        const oldest = savedCommentableMarkdownScroll.keys().next();
        if (!oldest.done) savedCommentableMarkdownScroll.delete(oldest.value);
      }
    };
    viewport.addEventListener("scroll", save);
    return () => viewport.removeEventListener("scroll", save);
  }, [positionKey]);

  return (
    <ScrollArea
      ref={root}
      data-fork-markdown-scroll
      className="min-h-0 flex-1"
      onKeyDown={onKeyDown}
      onCopy={(event) => {
        const surface = event.currentTarget;
        if (!(event.target instanceof Node) || !surface.contains(event.target)) return;
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        // Match the preview's scoped Select All, not a partial or external selection.
        if (
          range.startContainer !== surface ||
          range.startOffset !== 0 ||
          range.endContainer !== surface ||
          range.endOffset !== surface.childNodes.length
        ) {
          return;
        }
        event.preventDefault();
        event.clipboardData.clearData();
        event.clipboardData.setData("text/plain", text);
      }}
    >
      <ForkCommentableMarkdownPreview {...previewProps} />
    </ScrollArea>
  );
}

export function ForkWorkspaceMarkdownPreview({
  commentTarget,
  onKeyDown,
  text,
  ...previewProps
}: WorkspaceMarkdownProps) {
  // Exact rendered quotes need one complete DOM. Keep that mode bounded; larger Markdown
  // uses upstream virtualization and can still be commented on in the source view.
  if (text.length > 32 * 1024) {
    return <ChunkedMarkdown {...splitMarkdown(text)} {...previewProps} onKeyDown={onKeyDown} />;
  }
  return (
    <ScrollableCommentableMarkdown
      text={text}
      commentTarget={commentTarget}
      onKeyDown={onKeyDown}
      {...previewProps}
    />
  );
}
