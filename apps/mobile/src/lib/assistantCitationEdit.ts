import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import {
  assistantCitationCommentError,
  assistantCitationPromptLengthError,
} from "./assistantCitationDraft";

export interface AssistantCitationChipSelection {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export function assistantCitationFromChip(source: string) {
  const quote = collectAssistantCitations(source)[0];
  return quote?.start === 0 && quote.end === source.length ? quote.citation : null;
}

export function captureAssistantCitationEdit(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string;
  readonly draft: string;
  readonly selection: AssistantCitationChipSelection;
}) {
  const { start, end, source } = input.selection;
  const citation = assistantCitationFromChip(source);
  if (
    citation === null ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > input.draft.length ||
    input.draft.slice(start, end) !== source
  )
    return null;
  return { ...input, selection: { ...input.selection }, citation } as const;
}

export type PendingAssistantCitationEdit = NonNullable<
  ReturnType<typeof captureAssistantCitationEdit>
>;

interface AssistantCitationEditInput {
  readonly pending: PendingAssistantCitationEdit;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string | null;
  readonly canEdit: boolean;
  readonly draft: string;
}

function editTargetError(input: AssistantCitationEditInput): string | null {
  const { pending } = input;
  if (
    !input.canEdit ||
    input.draftKey !== pending.draftKey ||
    input.environmentId !== pending.environmentId ||
    input.threadId !== pending.threadId
  ) {
    return "The composer is not ready. Return to an editable prompt and try again.";
  }
  // Never guess which of two identical chips survived a background draft change.
  if (input.draft !== pending.draft) {
    return "The draft changed. Close this sheet and tap the quote again.";
  }
  return null;
}

export function prepareAssistantCitationEdit(
  input: AssistantCitationEditInput & {
    readonly comment: string;
  },
): { readonly error: string } | { readonly value: string; readonly cursor: number } {
  const targetError = editTargetError(input);
  if (targetError) return { error: targetError };
  const { pending } = input;
  const commentError = assistantCitationCommentError(input.comment);
  if (commentError) return { error: commentError };
  const marker = serializeAssistantCitation(
    withAssistantCitationComment(pending.citation, input.comment),
  );
  const { start, end } = pending.selection;
  const value = `${input.draft.slice(0, start)}${marker}${input.draft.slice(end)}`;
  const lengthError = assistantCitationPromptLengthError(value);
  if (lengthError) return { error: lengthError };
  return { value, cursor: start + marker.length };
}

export function prepareAssistantCitationRemoval(
  input: AssistantCitationEditInput,
): { readonly error: string } | { readonly value: string; readonly cursor: number } {
  const error = editTargetError(input);
  if (error) return { error };
  const { start, end } = input.pending.selection;
  return { value: input.draft.slice(0, start) + input.draft.slice(end), cursor: start };
}
