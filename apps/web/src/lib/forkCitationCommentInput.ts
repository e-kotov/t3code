export function createCitationCommentInput(initialText: string) {
  let text = initialText;
  let pending = true;
  let cancelled = false;
  let onChange: ((text: string) => void) | undefined;
  return {
    get text() {
      return text;
    },
    get pending() {
      return pending;
    },
    get cancelled() {
      return cancelled;
    },
    cancel() {
      cancelled = true;
      pending = false;
      onChange?.(text);
    },
    backspace() {
      text = Array.from(text).slice(0, -1).join("");
      onChange?.(text);
    },
    append(chunk: string) {
      text += chunk;
      onChange?.(text);
    },
    release() {
      pending = false;
    },
    subscribe(listener: (text: string) => void) {
      onChange = listener;
      listener(text);
      return () => {
        pending = false;
        onChange = undefined;
      };
    },
  };
}
