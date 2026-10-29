function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repairedId(id: string): string {
  return /^[a-z0-9_-]{1,110}:(file|image):[0-9]{1,6}$/i.test(id) ? id.replaceAll(":", "_") : id;
}

export function forkRepairSharedDraft<
  T extends { readonly attachments: readonly unknown[] } | null | undefined,
>(draft: T): T;
export function forkRepairSharedDraft(draft: unknown): unknown;
export function forkRepairSharedDraft(draft: unknown): unknown {
  if (!isObject(draft) || !Array.isArray(draft.attachments)) return draft;
  const ids = new Map<string, string>();
  const attachments = draft.attachments.map((attachment: unknown) => {
    if (!isObject(attachment) || typeof attachment.id !== "string") return attachment;
    const id = repairedId(attachment.id);
    if (id === attachment.id) return attachment;
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
  if (!isObject(document)) return document;
  return {
    ...document,
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
