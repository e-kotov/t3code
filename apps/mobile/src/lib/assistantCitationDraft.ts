import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type AssistantCitation,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { replaceTextSelection } from "@t3tools/client-runtime/text-paste";
import {
  expandAssistantCitationsForProvider,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import type { ComposerDraftInsertion } from "../state/use-composer-drafts";

export interface PendingAssistantCitation {
  readonly citation: AssistantCitation;
  readonly draftKey: string;
  readonly insertion: ComposerDraftInsertion;
}

export function assistantCitationCommentError(comment: string): string | null {
  return comment.trim().length > ASSISTANT_CITATION_MAX_COMMENT_LENGTH
    ? `Keep the comment within ${ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString("en-US")} characters.`
    : null;
}

export function assistantCitationPromptLengthError(prompt: string): string | null {
  const length = Math.max(prompt.length, expandAssistantCitationsForProvider(prompt).length);
  return length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? `The prompt exceeds the ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US")}-character limit. Shorten the quote, comment or prompt and try again.`
    : null;
}

export function prepareAssistantCitationInsertion(input: {
  readonly pending: PendingAssistantCitation;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string | null;
  readonly canInsert: boolean;
  readonly draft: string;
  readonly comment: string;
}): { readonly error: string } | { readonly value: string; readonly cursor: number } {
  if (
    !input.canInsert ||
    input.draftKey === null ||
    input.draftKey !== input.pending.draftKey ||
    input.environmentId !== input.pending.citation.environmentId ||
    input.threadId !== input.pending.citation.threadId
  ) {
    return { error: "The composer is not ready. Return to an editable prompt and try again." };
  }
  const commentError = assistantCitationCommentError(input.comment);
  if (commentError) return { error: commentError };
  const marker = serializeAssistantCitation(
    withAssistantCitationComment(input.pending.citation, input.comment),
  );
  // Citing assistant text must not replace a range left selected in the composer.
  const captured = input.pending.insertion;
  const cursor =
    captured.text === input.draft
      ? Math.max(0, Math.min(input.draft.length, Math.max(captured.start, captured.end)))
      : input.draft.length;
  const selection = { start: cursor, end: cursor };
  const before = input.draft.slice(0, selection.start);
  const after = input.draft.slice(selection.end);
  const leading = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailing = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const insertion = replaceTextSelection({
    value: input.draft,
    selection,
    text: `${leading}${marker}${trailing}`,
  });
  const lengthError = assistantCitationPromptLengthError(insertion.value);
  if (lengthError) return { error: lengthError };
  return insertion;
}
