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
  const selection = input.pending.insertion.text === input.draft
    ? input.pending.insertion
    : { start: input.draft.length, end: input.draft.length };
  const before = input.draft.slice(0, selection.start);
  const after = input.draft.slice(selection.end);
  const leading = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailing = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const insertion = replaceTextSelection({ value: input.draft, selection, text: `${leading}${marker}${trailing}` });
  const length = Math.max(insertion.value.length, expandAssistantCitationsForProvider(insertion.value).length);
  if (length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
    return { error: `The quote would exceed the ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US")}-character prompt limit. Shorten the quote, comment or prompt and try again.` };
  }
  return insertion;
}
