import { MessageId, type AssistantCitation, type EnvironmentId } from "@t3tools/contracts";
import {
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";
import { useEffect, useState, type RefObject } from "react";
import { Platform } from "react-native";

import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import { addAssistantCitationSelectionListener } from "../../native/SelectableMarkdownText";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { AssistantCitationSheet } from "./AssistantCitationSheet";

/**
 * Android text selection in an assistant message opens a quote sheet; adding
 * the quote appends its marker to the thread's composer draft. Returns the
 * sheet to render, or null while no quote is pending.
 */
export function useAssistantCitationSheet(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: AssistantCitation["threadId"];
  readonly composerDraftKey: string | null;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly composerEditorRef: RefObject<ComposerEditorHandle | null>;
}) {
  const { environmentId, threadId, composerEditorRef } = input;
  const [pendingCitation, setPendingCitation] = useState<AssistantCitation | null>(null);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = addAssistantCitationSelectionListener((selection) => {
      if (
        selection.environmentId !== environmentId ||
        selection.threadId !== threadId ||
        selection.text.trim().length === 0
      ) {
        return;
      }
      setPendingCitation({
        version: 1,
        environmentId,
        threadId,
        messageId: MessageId.make(selection.messageId),
        text: selection.text,
        start: selection.start,
        end: selection.end,
        prefix: selection.prefix,
        suffix: selection.suffix,
      });
    });
    return () => subscription.remove();
  }, [environmentId, threadId]);

  if (!pendingCitation) return null;
  const addCitation = (comment: string) => {
    const citation = withAssistantCitationComment(pendingCitation, comment);
    const marker = serializeAssistantCitation(citation);
    const currentDraft =
      input.composerDraftKey === null ? "" : getComposerDraftSnapshot(input.composerDraftKey).text;
    const nextDraft = currentDraft
      ? `${currentDraft}${/\s$/.test(currentDraft) ? "" : "\n"}${marker}`
      : marker;
    input.onChangeDraftMessage(nextDraft);
    setPendingCitation(null);
    requestAnimationFrame(() => {
      composerEditorRef.current?.focus();
      composerEditorRef.current?.setSelection({ start: nextDraft.length, end: nextDraft.length });
    });
  };
  return (
    <AssistantCitationSheet
      citation={pendingCitation}
      onCancel={() => setPendingCitation(null)}
      onAdd={addCitation}
    />
  );
}
