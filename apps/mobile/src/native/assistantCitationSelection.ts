import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import type { AssistantCitationSource } from "./SelectableMarkdownText.types";

interface AssistantCitationSelectionEvent extends AssistantCitationSource {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
  readonly suffix: string;
}

type Listener = (event: AssistantCitationSelectionEvent) => void;

const listeners = new Set<Listener>();

export function addAssistantCitationSelectionListener(listener: Listener): { remove(): void } {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

/**
 * Enriched supplies fragment-local offsets, not the whole-message text stream used by web.
 * Leave context empty rather than inventing selectors: source navigation then requires a
 * unique text match and may be unavailable for repeated phrases.
 */
export function emitAssistantCitationSelection(
  source: AssistantCitationSource,
  text: string,
  selection: { readonly start: number; readonly end: number },
): string | null {
  if (text.trim().length === 0) return "Select some assistant text to quote.";
  if (text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) {
    return `Select at most ${ASSISTANT_CITATION_MAX_TEXT_LENGTH.toLocaleString("en-US")} characters to quote.`;
  }
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.max(start + text.length, selection.end);
  const event = { ...source, text, start, end, prefix: "", suffix: "" };
  for (const listener of listeners) listener(event);
  return null;
}
