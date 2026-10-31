import { classifyComposerAttachmentFile } from "./composerAttachmentFiles";
import { pasteTextToFocusComposer } from "./composerFocusRedirect";

const textOnlyPasteEvents = new WeakSet<Event>();

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

export function textForPasteToFocusedComposer(
  event: ClipboardEvent,
  bypassAutoAttachment: boolean,
): string | null {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;
  const preferClipboardText = shouldPreferClipboardTextForPaste({
    bypassAutoAttachment,
    plainText: clipboardData.getData("text/plain"),
    files: Array.from(clipboardData.files),
    hasFolders: false,
  });
  return pasteTextToFocusComposer(event, preferClipboardText);
}
