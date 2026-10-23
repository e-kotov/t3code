import { MessageId, type AssistantCitation, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Platform } from "react-native";

import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import * as Dialog from "../../components/ui/Dialog";
import {
  prepareAssistantCitationInsertion,
  type PendingAssistantCitation,
} from "../../lib/assistantCitationDraft";
import { addAssistantCitationSelectionListener } from "../../native/assistantCitationSelection";
import {
  captureComposerDraftInsertion,
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
} from "../../state/use-composer-drafts";
import { AssistantCitationSheet } from "./AssistantCitationSheet";

export function useAssistantCitationSheet(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: AssistantCitation["threadId"];
  readonly composerDraftKey: string | null;
  readonly canInsert: boolean;
  readonly onChangeDraftMessage: (value: string) => void;
  readonly composerEditorRef: RefObject<ComposerEditorHandle | null>;
}) {
  const { environmentId, threadId, composerDraftKey, canInsert } = input;
  const latestInput = useRef(input);
  latestInput.current = input;
  const [pending, setPending] = useState<PendingAssistantCitation | null>(null);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = addAssistantCitationSelectionListener((selection) => {
      if (selection.environmentId !== environmentId || selection.threadId !== threadId) return;
      if (!canInsert || composerDraftKey === null) {
        Dialog.alert(
          "Cannot add quote",
          "The composer is not ready. Return to an editable prompt and try again.",
        );
        return;
      }
      setPending({
        draftKey: composerDraftKey,
        insertion: captureComposerDraftInsertion(composerDraftKey),
        citation: {
          version: 1,
          environmentId,
          threadId,
          messageId: MessageId.make(selection.messageId),
          text: selection.text,
          start: selection.start,
          end: selection.end,
          prefix: selection.prefix,
          suffix: selection.suffix,
        },
      });
    });
    return () => subscription.remove();
  }, [environmentId, threadId, composerDraftKey, canInsert]);

  if (pending === null) return null;
  if (
    pending.draftKey !== composerDraftKey ||
    pending.citation.environmentId !== environmentId ||
    pending.citation.threadId !== threadId
  ) {
    setPending(null);
    return null;
  }
  const addCitation = (comment: string): string | null => {
    const current = latestInput.current;
    const draftKey = current.composerDraftKey;
    const result = prepareAssistantCitationInsertion({
      pending,
      environmentId: current.environmentId,
      threadId: current.threadId,
      draftKey,
      canInsert: current.canInsert,
      draft: draftKey === null ? "" : getComposerDraftSnapshot(draftKey).text,
      comment,
    });
    if ("error" in result) return result.error;
    current.onChangeDraftMessage(result.value);
    const selection = { start: result.cursor, end: result.cursor };
    if (draftKey !== null) rememberComposerDraftSelection(draftKey, result.value, selection);
    setPending(null);
    requestAnimationFrame(() => {
      const target = latestInput.current;
      if (
        !target.canInsert ||
        target.environmentId !== current.environmentId ||
        target.threadId !== current.threadId ||
        target.composerDraftKey !== draftKey
      )
        return;
      target.composerEditorRef.current?.focus();
      target.composerEditorRef.current?.setSelection(selection);
    });
    return null;
  };
  return (
    <AssistantCitationSheet
      citation={pending.citation}
      onCancel={() => setPending(null)}
      onAdd={addCitation}
    />
  );
}
