import { MessageId, type AssistantCitation, type EnvironmentId } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Platform } from "react-native";

import type { ComposerEditorHandle } from "../../components/ComposerEditor";
import * as Dialog from "../../components/ui/Dialog";
import {
  prepareAssistantCitationInsertion,
  type PendingAssistantCitation,
} from "../../lib/assistantCitationDraft";
import { addAssistantCitationSelectionListener } from "../../native/assistantCitationSelection";
import { addAssistantCitationEditListener } from "../../native/assistantCitationEditing";
import {
  captureAssistantCitationEdit,
  prepareAssistantCitationEdit,
  prepareAssistantCitationRemoval,
  type PendingAssistantCitationEdit,
} from "../../lib/assistantCitationEdit";
import {
  captureComposerDraftInsertion,
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
} from "../../state/use-composer-drafts";
import { AssistantCitationSheet } from "./AssistantCitationSheet";

type PendingQuote =
  | (PendingAssistantCitation & {
      readonly mode: "create";
      readonly id: number;
      readonly environmentId: EnvironmentId;
      readonly threadId: AssistantCitation["threadId"];
    })
  | (PendingAssistantCitationEdit & { readonly mode: "edit"; readonly id: number });

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
  useLayoutEffect(() => {
    latestInput.current = input;
  }, [input]);
  const [pending, setPending] = useState<PendingQuote | null>(null);
  const nextPendingId = useRef(0);
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
        mode: "create",
        id: nextPendingId.current++,
        environmentId,
        threadId,
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
    const editSubscription =
      canInsert && composerDraftKey !== null
        ? addAssistantCitationEditListener(composerDraftKey, (selection) => {
            const edit = captureAssistantCitationEdit({
              environmentId,
              threadId,
              draftKey: composerDraftKey,
              draft: getComposerDraftSnapshot(composerDraftKey).text,
              selection,
            });
            if (edit === null) {
              Dialog.alert("Cannot edit quote", "The draft changed. Tap the quote again.");
              return;
            }
            setPending({ ...edit, mode: "edit", id: nextPendingId.current++ });
          })
        : null;
    return () => {
      subscription.remove();
      editSubscription?.remove();
    };
  }, [environmentId, threadId, composerDraftKey, canInsert]);

  if (pending === null) return null;
  if (
    pending.draftKey !== composerDraftKey ||
    pending.environmentId !== environmentId ||
    pending.threadId !== threadId ||
    (pending.mode === "edit" && !canInsert)
  ) {
    setPending(null);
    return null;
  }
  const submitCitation = (comment: string, action: "save" | "remove" = "save"): string | null => {
    const current = latestInput.current;
    const draftKey = current.composerDraftKey;
    const currentDraft = {
      environmentId: current.environmentId,
      threadId: current.threadId,
      draftKey,
      draft: draftKey === null ? "" : getComposerDraftSnapshot(draftKey).text,
      comment,
    };
    const result =
      pending.mode === "create"
        ? prepareAssistantCitationInsertion({
            ...currentDraft,
            pending,
            canInsert: current.canInsert,
          })
        : action === "remove"
          ? prepareAssistantCitationRemoval({
              ...currentDraft,
              pending,
              canEdit: current.canInsert,
            })
          : prepareAssistantCitationEdit({ ...currentDraft, pending, canEdit: current.canInsert });
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
      key={pending.id}
      citation={pending.citation}
      mode={pending.mode}
      onCancel={() => setPending(null)}
      onSubmit={submitCitation}
      onRemove={pending.mode === "edit" ? () => submitCitation("", "remove") : undefined}
    />
  );
}
