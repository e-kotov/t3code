import { classifyComposerAttachmentFile } from "./composerAttachmentFiles";
import {
  pasteTextToFocusComposer,
  shouldRedirectInputToComposer,
} from "./composerFocusRedirect";
import { splitTransferredFiles } from "./workspaceFileDrop";

const textOnlyPasteEvents = new WeakSet<Event>();

interface ComposerPasteEvent {
  readonly clipboardData: DataTransfer;
  readonly nativeEvent: Event;
}

interface PasteAsTextShortcutRef {
  current: number;
}

interface ComposerPasteData {
  readonly files: File[];
  readonly folders: File[];
  readonly plainText: string;
  readonly preferClipboardText: boolean;
}

export function shouldPreferClipboardTextForPaste(input: {
  readonly bypassAutoAttachment: boolean;
  readonly plainText: string;
  readonly files: ReadonlyArray<Pick<File, "name" | "type">>;
  readonly hasFolders: boolean;
}): boolean {
  return (
    input.bypassAutoAttachment &&
    input.plainText.length > 0 &&
    !input.hasFolders &&
    input.files.some(
      (file) =>
        classifyComposerAttachmentFile(file) !== "file" ||
        file.type.toLowerCase().startsWith("image/") ||
        file.name.toLowerCase().endsWith(".svg"),
    )
  );
}

export function markTextOnlyPasteEvent(event: Event): void {
  textOnlyPasteEvents.add(event);
}

export function isTextOnlyPasteEvent(event: Event): boolean {
  return textOnlyPasteEvents.has(event);
}

function preferTextForPaste(
  bypassAutoAttachment: boolean,
  plainText: string,
  files: ReadonlyArray<File>,
  folders: ReadonlyArray<File>,
): boolean {
  return shouldPreferClipboardTextForPaste({
    bypassAutoAttachment,
    plainText,
    files,
    hasFolders: folders.length > 0,
  });
}

export function prepareComposerPaste(
  event: ComposerPasteEvent,
  bypassAutoAttachment: boolean,
): ComposerPasteData {
  const { files, folders } = splitTransferredFiles(event.clipboardData);
  const plainText = event.clipboardData.getData("text/plain");
  const preferClipboardText = preferTextForPaste(
    bypassAutoAttachment,
    plainText,
    files,
    folders,
  );
  if (preferClipboardText) markTextOnlyPasteEvent(event.nativeEvent);
  return { files, folders, plainText, preferClipboardText };
}

export function pasteToFocusedComposer(
  event: ClipboardEvent,
  pasteAsTextShortcutUntilRef: PasteAsTextShortcutRef,
): {
  text: string;
  clipboardData: DataTransfer;
  bypassAutoAttachment: boolean;
} | null {
  const bypassAutoAttachment = Date.now() <= pasteAsTextShortcutUntilRef.current;
  pasteAsTextShortcutUntilRef.current = 0;
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;
  const { files, folders } = splitTransferredFiles(clipboardData);
  const preferClipboardText = preferTextForPaste(
    bypassAutoAttachment,
    clipboardData.getData("text/plain"),
    files,
    folders,
  );
  let text: string | null;
  if (preferClipboardText) {
    text = shouldRedirectInputToComposer(event)
      ? clipboardData.getData("text/plain")
      : null;
  } else {
    text = pasteTextToFocusComposer(event);
  }
  return text === null ? null : { text, clipboardData, bypassAutoAttachment };
}
