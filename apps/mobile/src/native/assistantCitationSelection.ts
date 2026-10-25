import { ASSISTANT_CITATION_MAX_TEXT_LENGTH } from "@t3tools/contracts";
export interface AssistantCitationSource {
  readonly environmentId: string;
  readonly threadId: string;
  readonly messageId: string;
}

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
 * Native context disambiguates repeated phrases without treating local offsets as global.
 * Older native clients omit context and retain the unique-text fallback.
 */
export function emitAssistantCitationSelection(
  source: AssistantCitationSource,
  text: string,
  selection: { readonly start: number; readonly end: number },
  context?: { readonly prefix: string; readonly suffix: string },
): string | null {
  if (text.trim().length === 0) return "Select some assistant text to quote.";
  if (text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) {
    return `Select at most ${ASSISTANT_CITATION_MAX_TEXT_LENGTH.toLocaleString("en-US")} characters to quote.`;
  }
  const start = Math.max(0, Math.min(selection.start, selection.end));
  const end = Math.max(start + text.length, selection.end);
  const event = {
    ...source,
    text,
    start,
    end,
    prefix: context?.prefix ?? "",
    suffix: context?.suffix ?? "",
  };
  for (const listener of listeners) listener(event);
  return null;
}
