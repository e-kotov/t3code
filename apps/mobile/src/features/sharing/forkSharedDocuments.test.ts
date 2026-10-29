import { describe, expect, it, vi } from "@effect/vitest";
import type { SharePayload } from "expo-sharing";
import { ChatAttachmentId, ComposerContextId, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";
import { composerContextSendBlockReason, uploadedComposerContext } from "../../lib/composerContext";
import {
  decodePersistedComposerState,
  mergeComposerDraftContentState,
  type ComposerDraft,
} from "../../state/use-composer-drafts";
import { makeIncomingShareImports } from "../threads/incomingShareImport";

import { IncomingShareInbox } from "./incoming-share-inbox";
import {
  buildIncomingShareDraft,
  decodeIncomingShareDraft,
  selectIncomingShareAttachmentsForServer,
  type IncomingShareDraft,
} from "./incoming-share-model";
import { forkRepairPersistedSharedDrafts } from "./forkSharedAttachmentIds";

const isChatAttachmentId = Schema.is(ChatAttachmentId);

async function importIntoDraft(share: IncomingShareDraft, draftKey: string) {
  let drafts: Record<string, ComposerDraft> = {};
  const registry = AtomRegistry.make();
  const imports = makeIncomingShareImports({
    registry,
    getShare: () => share,
    reserve: async () => {},
    release: async () => {},
    consume: async () => {},
    readDraft: () => drafts[draftKey] ?? { text: "", attachments: [] },
    undoMerge: async () => {},
    mergeIntoDraft: async (key, content) => {
      drafts = mergeComposerDraftContentState(drafts, key, content);
      return { skippedAttachmentCount: 0 };
    },
    selectAttachments: (incoming) => ({
      status: "ready",
      attachments: incoming.attachments,
      warnings: [],
    }),
    releaseUnusedAttachments: vi.fn(),
    onWarnings: vi.fn(),
    onImportFailure: vi.fn(),
    onCancelFailure: vi.fn(),
    leave: vi.fn(),
  });
  const target = {
    flowKey: "share-import",
    routeKey: "share-route",
    draftKey,
    shareId: share.id,
    destination: { environmentId: "environment", projectId: "project" },
  };
  const phase = imports.phaseAtom(target);
  const unmount = registry.mount(phase);
  try {
    registry.get(phase);
    await imports.settled(target);
    expect(registry.get(phase)).toBe("done");
    return drafts;
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("Android shared documents", () => {
  it.each([
    { name: "Episode transcript.txt", mimeType: "text/plain", shareType: "file" as const },
    { name: "Paper.pdf", mimeType: "application/pdf", shareType: "file" as const },
    { name: "Episode.mp3", mimeType: "audio/mpeg", shareType: "audio" as const },
    { name: "Clip.mp4", mimeType: "video/mp4", shareType: "video" as const },
  ])(
    "keeps $name from a content provider in the durable inbox",
    async ({ name, mimeType, shareType }) => {
      let payloads: ReadonlyArray<SharePayload> = [
        {
          shareType,
          value: "content://sender.provider/shared/123",
          originalName: name,
          mimeType,
        },
      ];
      const stored = new Map<string, IncomingShareDraft>();
      const localUri = `file:///documents/${encodeURIComponent(name)}`;
      const readBase64 = vi.fn(async () => "unused");
      const persistFile = vi.fn(async () => localUri);
      const inbox = new IncomingShareInbox({
        loadDrafts: async () => [...stored.values()],
        writeDraft: async (draft) => void stored.set(draft.id, draft),
        removeDraft: async (id) => void stored.delete(id),
        getPayloads: () => payloads,
        clearPayloads: () => {
          payloads = [];
        },
        buildDraft: async (input) => ({
          draft: await buildIncomingShareDraft({
            ...input,
            resolvedPayloads: [],
            fileReader: {
              readBase64,
              persistFile,
              readSize: async (uri) => (uri.startsWith("content:") ? 0 : 55 * 1024),
              removeOwnedFile: async () => {},
            },
          }),
          cleanup: async () => {},
        }),
        idForPayloads: async () => "shared-document",
        now: () => "2026-10-28T21:00:00.000Z",
      });

      const drafts = await inbox.refresh({ ingestNative: true });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.warnings).toEqual([]);
      expect(isChatAttachmentId(drafts[0]!.attachments[0]!.id)).toBe(true);
      expect(drafts[0]?.attachments).toEqual([
        {
          id: "shared-document_file_0",
          type: "file",
          name,
          mimeType,
          sizeBytes: 55 * 1024,
          fileUri: localUri,
        },
      ]);
      expect(payloads).toEqual([]);
      expect(persistFile).toHaveBeenCalledTimes(1);
      expect(persistFile).toHaveBeenCalledWith("content://sender.provider/shared/123", name);
      expect(readBase64).not.toHaveBeenCalled();
      expect(await inbox.refresh({ ingestNative: true })).toEqual(drafts);
      expect(persistFile).toHaveBeenCalledTimes(1);
      expect(
        selectIncomingShareAttachmentsForServer({
          attachments: drafts[0]!.attachments,
          serverConfig: {
            environment: {
              capabilities: {
                fileAttachments: { maxUploadBytes: 50 * 1024 * 1024 },
              },
            },
          },
        }),
      ).toEqual({ status: "ready", attachments: drafts[0]!.attachments, warnings: [] });
      const content = { ...drafts[0]!, sourceShareId: drafts[0]!.id };
      const merged = await importIntoDraft(drafts[0]!, "environment:thread");
      const draft = merged["environment:thread"]!;
      expect(composerContextSendBlockReason(draft.context)).toBeNull();
      expect(isChatAttachmentId(draft.attachments[0]!.id)).toBe(true);
      expect(draft.attachments[0]).toEqual({
        ...drafts[0]!.attachments[0],
        id: "shared-document_file_0",
      });
      if (shareType === "video") {
        expect(draft.context).toBeUndefined();
      } else {
        expect(draft.context?.records).toEqual([
          expect.objectContaining({ kind: "file", attachmentId: draft.attachments[0]!.id }),
        ]);
      }
      expect(mergeComposerDraftContentState(merged, "environment:thread", content)).toBe(merged);
    },
  );

  it.each([false, true])(
    "recovers an already uploaded transcript without losing its chip (archived: %s)",
    (archived) => {
      const id = "share-transcript:file:0";
      const attachment = {
        id,
        type: "file" as const,
        name: "Transcript.txt",
        mimeType: "text/plain",
        sizeBytes: 55 * 1024,
        fileUri: "file:///documents/transcript.txt",
        uploadedAttachmentId: "server-file",
        uploadEnvironmentId: EnvironmentId.make("environment"),
      };
      const record = {
        version: 1 as const,
        kind: "file" as const,
        contextId: ComposerContextId.make("original-chip"),
        attachmentId: id,
        label: attachment.name,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
      const original = {
        text: "Summarize [Transcript.txt](t3-context://v1/file/original-chip) ",
        attachments: [attachment],
        context: { version: 1 as const, records: [record] },
        importedShareIds: ["share-transcript"],
      };
      const document = {
        schemaVersion: 1,
        sharedAttachmentIdsVersion: 1,
        drafts: archived ? {} : { thread: original },
        ...(archived
          ? { signedOutDrafts: { account: { drafts: { thread: original }, queuedMessages: [] } } }
          : {}),
      };
      const migrated = forkRepairPersistedSharedDrafts(document);
      expect(forkRepairPersistedSharedDrafts(migrated)).toEqual(migrated);
      const decoded = decodePersistedComposerState(document);
      const draft = (
        archived ? decoded.cloudDrafts.signedOut.account?.drafts.thread : decoded.drafts.thread
      )!;
      expect(draft).toEqual({
        ...original,
        attachments: [{ ...attachment, id: "share-transcript_file_0" }],
        context: { version: 1, records: [{ ...record, attachmentId: "share-transcript_file_0" }] },
      });
      expect(composerContextSendBlockReason(draft.context)).toBeNull();
      expect(
        uploadedComposerContext(draft.context, draft.attachments, [
          { id: attachment.uploadedAttachmentId },
        ]),
      ).toEqual({
        version: 1,
        records: [{ ...record, attachmentId: "server-file" }],
      });
      expect(
        decodePersistedComposerState({ schemaVersion: 1, drafts: { thread: draft } }).drafts.thread,
      ).toEqual(draft);
      expect(
        mergeComposerDraftContentState({ thread: draft }, "thread", {
          text: "",
          attachments: [attachment],
          sourceShareId: "share-transcript",
        }).thread,
      ).toBe(draft);
      expect(document.drafts).toEqual(archived ? {} : { thread: original });
    },
  );

  it("recovers a transcript whose invalid context record was already discarded", () => {
    const original = {
      text: "Summarize [Transcript.txt](t3-context://v1/file/share-transcript_file_0) ",
      attachments: [
        {
          id: "share-transcript:file:0",
          type: "file",
          name: "Transcript.txt",
          mimeType: "text/plain",
          sizeBytes: 55 * 1024,
          fileUri: "file:///documents/transcript.txt",
        },
      ],
    };
    const draft = decodePersistedComposerState({ schemaVersion: 1, drafts: { thread: original } })
      .drafts.thread!;
    expect(draft.text).toBe(original.text);
    expect(draft.context?.records).toHaveLength(1);
    expect(composerContextSendBlockReason(draft.context)).toBeNull();
  });

  it("accepts generated image IDs before importing", async () => {
    const share = await buildIncomingShareDraft({
      id: "share-photo",
      createdAt: "2026-10-29T13:00:00.000Z",
      payloads: [{ shareType: "image", value: "file:///photo.png", mimeType: "image/png" }],
      resolvedPayloads: [],
      fileReader: { readBase64: async () => "YWJj", removeOwnedFile: async () => {} },
    });
    expect(share.attachments).toHaveLength(1);
    expect(isChatAttachmentId(share.attachments[0]!.id)).toBe(true);
    const draft = (await importIntoDraft(share, "thread")).thread!;
    expect(draft.attachments).toEqual(share.attachments);
  });

  it("loads a pending inbox share with legacy IDs before importing", async () => {
    const original = {
      schemaVersion: 1,
      id: "share-pending",
      createdAt: "2026-10-29T13:00:00.000Z",
      text: "Summarize",
      attachments: [
        {
          id: "share-pending:audio:0",
          type: "file",
          name: "Transcript.txt",
          mimeType: "text/plain",
          sizeBytes: 55 * 1024,
          fileUri: "file:///transcript.txt",
        },
      ],
      warnings: [],
    };
    const share = decodeIncomingShareDraft(original);
    expect(share.id).toBe(original.id);
    expect(share.attachments[0]?.id).toBe("share-pending_audio_0");
    const draft = (await importIntoDraft(share, "thread")).thread!;
    expect(composerContextSendBlockReason(draft.context)).toBeNull();
    expect(draft.importedShareIds).toEqual([original.id]);
    expect(original.attachments[0]?.id).toBe("share-pending:audio:0");
  });

  it.each([
    { id: "share:audio:0", base: "share_audio_0" },
    { id: "share/v2?document#0", base: "share_v2_document_0" },
    { id: "x".repeat(140), base: "x".repeat(110) },
    { id: "", base: "file" },
  ])("recovers unfamiliar attachment IDs without overwriting a valid ID: $id", ({ id, base }) => {
    const file = {
      id,
      type: "file",
      name: "Transcript.txt",
      mimeType: "text/plain",
      sizeBytes: 55 * 1024,
      fileUri: "file:///transcript.txt",
    };
    const valid = { ...file, id: base, fileUri: "file:///other.txt" };
    const draft = decodePersistedComposerState({
      schemaVersion: 1,
      drafts: { thread: { text: "Summarize", attachments: [file, valid] } },
    }).drafts.thread!;
    expect(draft.attachments).toEqual([{ ...file, id: `${base}_2` }, valid]);
    expect(draft.context?.records).toHaveLength(2);
    expect(composerContextSendBlockReason(draft.context)).toBeNull();
    expect(draft.attachments.every((attachment) => isChatAttachmentId(attachment.id))).toBe(true);
  });
});
