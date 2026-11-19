import { m } from "../i18n/messages";
import { msg } from "gt-react-native";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";
import { expandAssistantCitationsForProvider } from "@t3tools/shared/assistantCitations";
import type { ComposerDraftInsertion } from "../state/use-composer-drafts";

export function assistantCitationPromptLengthError(prompt: string): string | null {
  const length = Math.max(prompt.length, expandAssistantCitationsForProvider(prompt).length);
  return length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? m(
        msg(
          "The prompt exceeds the {value1}-character limit. Shorten the quote, comment or prompt and try again.",
          { value1: PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US") },
        ),
      )
    : null;
}

export function rejectOversizedAssistantCitationPrompt(
  prompt: string,
  alert: (title: string, message: string) => void,
): boolean {
  const error = assistantCitationPromptLengthError(prompt);
  if (error === null) return false;
  alert(m(msg("Prompt too long")), error);
  return true;
}

/** A quote is added after the selection left in the composer, not instead of it. */
export function citationCaretAfterSelection(input: ComposerDraftInsertion): ComposerDraftInsertion {
  const caret = Math.max(0, Math.min(input.text.length, Math.max(input.start, input.end)));
  return { text: input.text, start: caret, end: caret };
}
