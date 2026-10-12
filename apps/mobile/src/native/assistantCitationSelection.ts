import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
import type { AssistantCitationSource } from "./SelectableMarkdownText.types";

export interface AssistantCitationSelectionEvent extends AssistantCitationSource {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
  readonly suffix: string;
}

type Listener = (event: AssistantCitationSelectionEvent) => void;

const listeners = new Set<Listener>();

/** Thread screens subscribe here; markdown views emit from their "Cite" selection action. */
export function addAssistantCitationSelectionListener(listener: Listener): { remove(): void } {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

/**
 * Enriched reports offsets into the rendered text of one markdown view, but not the
 * surrounding characters, so the context selectors stay empty.
 */
export function emitAssistantCitationSelection(
  source: AssistantCitationSource,
  text: string,
  selection: { readonly start: number; readonly end: number },
): void {
  if (text.trim().length === 0 || text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return;
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.max(start + text.length, selection.end);
  const event = { ...source, text, start, end, prefix: "", suffix: "" };
  for (const listener of listeners) listener(event);
}
