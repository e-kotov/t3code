import { m } from "../i18n/messages";
import { msg } from "gt-react-native";
import * as Effect from "effect/Effect";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import { scopedThreadKey } from "../lib/scopedEntities";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import { setThreadComposerError } from "./thread-composer-error";

async function recoverCompactAction(
  queuedMessage: QueuedThreadMessage,
  revision: number,
  message: string,
): Promise<"restored" | "deferred" | null> {
  if (
    !queuedMessage.compactAction ||
    queuedMessage.text.trim().toLowerCase() !== "/compact" ||
    queuedMessage.attachments.length > 0 ||
    queuedMessage.context ||
    queuedMessage.creation
  ) {
    return null;
  }
  const removed = await removeThreadOutboxMessage(
    queuedMessage,
    revision,
    () => !appAtomRegistry.get(editingQueuedMessageIdsAtom)[queuedMessage.messageId],
  );
  if (!removed) return "deferred";
  setThreadComposerError(
    scopedThreadKey(queuedMessage.environmentId, queuedMessage.threadId),
    m(msg("Compaction failed: {value1}", { value1: message })),
    queuedMessage.messageId,
  );
  return "restored";
}

export const recoverRejectedCompactAction = Effect.fn("ThreadOutbox.recoverRejectedCompactAction")(
  (queuedMessage: QueuedThreadMessage, revision: number, message: string) =>
    Effect.tryPromise({
      try: () => recoverCompactAction(queuedMessage, revision, message),
      catch: (cause) => ({ cause }),
    }),
);
