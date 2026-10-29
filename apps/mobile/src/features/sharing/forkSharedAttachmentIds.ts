import { ChatAttachmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isAttachmentId = Schema.is(ChatAttachmentId);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function forkAttachmentIdBase(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 110) || "file";
}

export function forkRepairSharedDraft(draft: unknown): unknown {
  if (!isObject(draft) || !Array.isArray(draft.attachments)) return draft;
  const ids = new Map<string, string>();
  const used = new Set(
    draft.attachments.flatMap((attachment: unknown) =>
      isObject(attachment) && typeof attachment.id === "string" && isAttachmentId(attachment.id)
        ? [attachment.id]
        : [],
    ),
  );
  const attachments = draft.attachments.map((attachment: unknown) => {
    if (!isObject(attachment) || typeof attachment.id !== "string") return attachment;
    if (isAttachmentId(attachment.id)) return attachment;
    const existingId = ids.get(attachment.id);
    if (existingId) return { ...attachment, id: existingId };
    const base = forkAttachmentIdBase(attachment.id);
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}_${suffix}`;
    used.add(id);
    ids.set(attachment.id, id);
    return { ...attachment, id };
  });
  if (ids.size === 0) return draft;
  const context = draft.context;
  return {
    ...draft,
    attachments,
    ...(isObject(context) && Array.isArray(context.records)
      ? {
          context: {
            ...context,
            records: context.records.map((record: unknown) =>
              isObject(record) &&
              (record.kind === "file" || record.kind === "image") &&
              typeof record.attachmentId === "string" &&
              ids.has(record.attachmentId)
                ? { ...record, attachmentId: ids.get(record.attachmentId) }
                : record,
            ),
          },
        }
      : {}),
  };
}

function repairDrafts(drafts: unknown): unknown {
  if (!isObject(drafts)) return drafts;
  return Object.fromEntries(
    Object.entries(drafts).map(([key, draft]) => [key, forkRepairSharedDraft(draft)]),
  );
}

// Repair bindings before ForwardCompatibleArray can discard invalid context records.
export function forkRepairPersistedSharedDrafts(document: unknown): unknown {
  if (!isObject(document) || document.sharedAttachmentIdsVersion === 1) return document;
  return {
    ...document,
    sharedAttachmentIdsVersion: 1,
    drafts: repairDrafts(document.drafts),
    ...(isObject(document.signedOutDrafts)
      ? {
          signedOutDrafts: Object.fromEntries(
            Object.entries(document.signedOutDrafts).map(([account, saved]) => [
              account,
              isObject(saved) ? { ...saved, drafts: repairDrafts(saved.drafts) } : saved,
            ]),
          ),
        }
      : {}),
  };
}
