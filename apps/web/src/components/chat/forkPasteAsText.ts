import { shouldHandleComposerAttachmentPaste } from "./composerAttachmentFiles";
import {
  pasteTextToFocusComposer as pastePlainTextToFocusComposer,
  shouldRedirectInputToComposer,
} from "./composerFocusRedirect";
import { DESKTOP_PASTE_AS_TEXT_EVENT } from "../../lib/desktopPasteAsText";
import { splitTransferredFiles } from "./workspaceFileDrop";

const textOnlyPasteEvents = new WeakSet<Event>();

export function shouldPreferClipboardTextForPaste(input: {
  readonly event: Event;
  readonly bypassAutoAttachment: boolean;
  readonly plainText: string;
  readonly files: ReadonlyArray<File>;
  readonly folders: ReadonlyArray<File>;
}): boolean {
  const preferClipboardText =
    input.bypassAutoAttachment &&
    input.plainText.length > 0 &&
    input.folders.length === 0 &&
    shouldHandleComposerAttachmentPaste({
      files: input.files,
      plainText: input.plainText,
    });
  if (preferClipboardText) markTextOnlyPasteEvent(input.event);
  return preferClipboardText;
}

export function markTextOnlyPasteEvent(event: Event): void {
  textOnlyPasteEvents.add(event);
}

export function isTextOnlyPasteEvent(event: Event): boolean {
  return textOnlyPasteEvents.has(event);
}

export function listenForDesktopPasteAsText(
  target: EventTarget,
  deadline: { current: number },
): () => void {
  const handler = (event: Event) => {
    if (shouldRedirectInputToComposer(event)) deadline.current = Date.now() + 1_000;
  };
  target.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, handler, true);
  return () => target.removeEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, handler, true);
}

export function pasteTextToFocusComposer(
  event: ClipboardEvent,
  pasteAsTextShortcutUntilRef: { current: number },
): string | null {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;
  const { files, folders } = splitTransferredFiles(clipboardData);
  const plainText = clipboardData.getData("text/plain");
  const preferClipboardText = shouldPreferClipboardTextForPaste({
    event,
    bypassAutoAttachment: Date.now() <= pasteAsTextShortcutUntilRef.current,
    plainText,
    files,
    folders,
  });
  if (preferClipboardText) {
    return shouldRedirectInputToComposer(event) ? plainText : null;
  }
  return pastePlainTextToFocusComposer(event);
}
