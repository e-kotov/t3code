interface PasteEventControl {
  preventDefault(): void;
  stopPropagation(): void;
}

export function pasteAsText(
  bypassAutoAttachment: boolean,
  plainText: string,
  event: PasteEventControl,
  insertText: (text: string, position: "cursor") => boolean,
): boolean {
  if (!bypassAutoAttachment) return false;
  event.preventDefault();
  event.stopPropagation();
  if (plainText.length > 0) insertText(plainText, "cursor");
  return true;
}
