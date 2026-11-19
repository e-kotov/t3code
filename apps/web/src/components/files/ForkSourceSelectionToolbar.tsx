import { useGT } from "gt-react";
import { QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import {
  FILE_TEXT_QUOTE_MAX_LENGTH,
  type FileTextQuote,
  captureShadowSourceTextSelection,
} from "./forkFileSublineComments";

interface CapturedSourceSelection {
  readonly startLine: number;
  readonly endLine: number;
  readonly quote: FileTextQuote;
  readonly position: SelectionActionPoint;
}

export function ForkSublineQuoteBadge({ text }: { readonly text: string }) {
  const snippet = text.replace(/\s+/g, " ").trim();
  if (snippet.length === 0) return null;
  return (
    <div
      data-file-comment-ui
      className="mx-3 mt-1 mb-0.5 flex items-center gap-1.5 border-s-2 border-primary/45 bg-muted/40 px-2 py-1 font-sans text-2xs text-muted-foreground"
    >
      <QuoteIcon className="size-3 shrink-0 text-primary/70" aria-hidden="true" />
      <span className="min-w-0 truncate">{snippet}</span>
    </div>
  );
}

export function ForkSourceSelectionToolbar({
  surfaceEl,
  portalTarget,
  contents,
  disabled = false,
  onComment,
}: {
  readonly surfaceEl: HTMLElement | null;
  readonly portalTarget?: HTMLElement | null | undefined;
  readonly contents: string;
  readonly disabled?: boolean | undefined;
  readonly onComment: (selection: {
    readonly startLine: number;
    readonly endLine: number;
    readonly quote: FileTextQuote;
  }) => void;
}) {
  const gt = useGT();
  const [selection, setSelection] = useState<CapturedSourceSelection | null>(null);
  const toolbarRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clamps the floating toolbar button inside the window bounds before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to shadow-root source text selection changes to position the floating Comment button
  useEffect(() => {
    if (!surfaceEl || disabled) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const shadowRoot = surfaceEl.querySelector("diffs-container")?.shadowRoot;
      if (!shadowRoot) {
        clear();
        return;
      }
      const captured = captureShadowSourceTextSelection(
        shadowRoot,
        contents,
        window.getSelection(),
      );
      if (!captured) {
        clear();
        return;
      }
      const scroller = surfaceEl.classList.contains("file-preview-virtualizer")
        ? surfaceEl
        : (surfaceEl.querySelector<HTMLElement>(".file-preview-virtualizer") ?? surfaceEl);
      const bounds = scroller.getBoundingClientRect();
      if (!isSelectionRectVisible(captured.rect, [bounds])) {
        clear();
        return;
      }
      const pointerOnText =
        pointer !== null &&
        pointer.x >= captured.rect.left - 12 &&
        pointer.x <= captured.rect.right + 12 &&
        pointer.y >= captured.rect.top - 12 &&
        pointer.y <= captured.rect.bottom + 12;
      setSelection({
        startLine: captured.startLine,
        endLine: captured.endLine,
        quote: captured.quote,
        position: resolveSelectionActionPosition({
          bounds,
          selectionRect: captured.lastRect,
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
  }, [contents, disabled, surfaceEl]);

  if (!selection || disabled) return null;
  const tooLong = selection.quote.text.length > FILE_TEXT_QUOTE_MAX_LENGTH;
  const button = (
    <Button
      ref={toolbarRef}
      type="button"
      size="xs"
      variant="glass"
      disabled={tooLong}
      data-file-comment-ui
      aria-label={tooLong ? gt("Shorten selection") : gt("Comment on selected text")}
      className="fixed z-50 max-w-[calc(100vw-1rem)]"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        if (tooLong) return;
        window.getSelection()?.removeAllRanges();
        actionsRef.current?.cancel();
        setSelection(null);
        onComment({
          startLine: selection.startLine,
          endLine: selection.endLine,
          quote: selection.quote,
        });
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
      {tooLong ? gt("Shorten selection") : gt("Comment", { $context: "verb, submit button" })}
    </Button>
  );

  return createPortal(button, portalTarget ?? document.body);
}
