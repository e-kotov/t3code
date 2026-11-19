import { m } from "../i18n/messages";
import { msg } from "gt-react-native";
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
    ? m(
        msg("Keep the comment within {value1} characters.", {
          value1: ASSISTANT_CITATION_MAX_COMMENT_LENGTH.toLocaleString("en-US"),
        }),
      )
    : null;
}

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

/** Each platform offers exactly one quote capture action, only for a visible composer. */
export function assistantCitationCaptureAvailable(
  platform: string,
  showContent: boolean | undefined,
  target: "android" | "ios",
): boolean {
  return platform === target && showContent !== false;
}

export function assistantCitationComposerReady(
  props: {
    readonly showContent?: boolean;
    readonly composerDraftKey: string | null;
    readonly isSavingQueuedEdit?: boolean;
    readonly draftMode?: { readonly interactionLocked?: boolean };
  },
  state: {
    readonly platform: string;
    readonly isProviderSubagent: boolean;
    readonly composerSlotHidden: boolean;
    readonly voiceInput: { readonly isBusy: boolean; readonly ownerKey: string | null };
  },
): boolean {
  return (
    assistantCitationCaptureAvailable(state.platform, props.showContent, "android") &&
    !state.isProviderSubagent &&
    !state.composerSlotHidden &&
    props.composerDraftKey !== null &&
    !props.isSavingQueuedEdit &&
    !props.draftMode?.interactionLocked &&
    !(state.voiceInput.isBusy && state.voiceInput.ownerKey === props.composerDraftKey)
  );
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
    return {
      error: m(msg("The composer is not ready. Return to an editable prompt and try again.")),
    };
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
