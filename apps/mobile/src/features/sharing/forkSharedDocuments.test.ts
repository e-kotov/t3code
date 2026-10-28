import { describe, expect, it, vi } from "@effect/vitest";
import type { SharePayload } from "expo-sharing";

import { IncomingShareInbox } from "./incoming-share-inbox";
import {
  buildIncomingShareDraft,
  selectIncomingShareAttachmentsForServer,
  type IncomingShareDraft,
} from "./incoming-share-model";

describe("Android shared documents", () => {
  it.each([
    { name: "Episode transcript.txt", mimeType: "text/plain" },
    { name: "Paper.pdf", mimeType: "application/pdf" },
  ])("keeps $name from a content provider in the durable inbox", async ({ name, mimeType }) => {
    let payloads: ReadonlyArray<SharePayload> = [
      {
        shareType: "file",
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
            readSize: async (uri) => (uri.startsWith("content:") ? 0 : 123),
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
    expect(drafts[0]?.attachments).toEqual([
      {
        id: "shared-document:file:0",
        type: "file",
        name,
        mimeType,
        sizeBytes: 123,
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
              attachmentUploads: true,
              fileAttachments: { maxUploadBytes: 50 * 1024 * 1024 },
            },
          },
        },
      }),
    ).toEqual({ status: "ready", attachments: drafts[0]!.attachments, warnings: [] });
  });
});
