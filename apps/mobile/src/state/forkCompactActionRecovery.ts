import type { QueuedThreadMessage } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import { scopedThreadKey } from "../lib/scopedEntities";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { removeThreadOutboxMessage } from "./thread-outbox-removal";
import { setThreadComposerError } from "./thread-composer-error";

export async function recoverRejectedCompactAction(
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
    `Compaction failed: ${message}`,
    queuedMessage.messageId,
  );
  return "restored";
}
