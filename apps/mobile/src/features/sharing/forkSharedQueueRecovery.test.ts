import { describe, expect, it } from "@effect/vitest";
import { ChatAttachmentId, ComposerContextId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { composerContextSendBlockReason, uploadedComposerContext } from "../../lib/composerContext";
import { decodeQueuedThreadMessage } from "../../state/thread-outbox-model";
import {
  decodePersistedComposerState,
  mergeComposerDraftContentState,
} from "../../state/use-composer-drafts";

const isAttachmentId = Schema.is(ChatAttachmentId);

describe("legacy shared-file queue recovery", () => {
  it.each(["outbox", "signed-out archive"])(
    "restores a rejected message from the %s into a sendable draft",
    (source) => {
      const attachment = {
        id: "share-old:file:0",
        type: "file" as const,
        name: "Transcript.txt",
        mimeType: "text/plain",
        sizeBytes: 55 * 1024,
        fileUri: "file:///documents/transcript.txt",
        uploadedAttachmentId: "server-file",
        uploadEnvironmentId: "environment",
      };
      const record = {
        version: 1 as const,
        kind: "file" as const,
        contextId: ComposerContextId.make("transcript"),
        attachmentId: attachment.id,
        label: attachment.name,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
      const stored = {
        schemaVersion: 3,
        environmentId: "environment",
        threadId: "thread",
        messageId: "message",
        commandId: "command",
        createdAt: "2026-10-29T13:00:00.000Z",
        text: "Summarize [Transcript.txt](t3-context://v1/file/transcript) ",
        context: { version: 1 as const, records: [record] },
        attachments: [attachment],
      };
      const queued =
        source === "outbox"
          ? decodeQueuedThreadMessage(stored)
          : decodePersistedComposerState({
              schemaVersion: 1,
              sharedAttachmentIdsVersion: 1,
              drafts: {},
              signedOutDrafts: {
                account: { drafts: {}, queuedMessages: [stored] },
              },
            }).cloudDrafts.signedOut.account!.queuedMessages[0]!;

      expect(queued.attachments).toEqual([{ ...attachment, id: "share-old_file_0" }]);
      expect(queued.context?.records).toEqual([{ ...record, attachmentId: "share-old_file_0" }]);
      const restored = mergeComposerDraftContentState({}, "environment:thread", queued)[
        "environment:thread"
      ]!;
      expect(restored.text).toBe(stored.text);
      expect(isAttachmentId(restored.attachments[0]!.id)).toBe(true);
      expect(composerContextSendBlockReason(restored.context)).toBeNull();
      expect(
        uploadedComposerContext(restored.context, restored.attachments, [{ id: "server-file" }]),
      ).toEqual({
        version: 1,
        records: [{ ...record, attachmentId: "server-file" }],
      });
      const restarted = decodePersistedComposerState({
        schemaVersion: 1,
        sharedAttachmentIdsVersion: 1,
        drafts: { "environment:thread": restored },
      }).drafts["environment:thread"];
      expect(restarted).toEqual(restored);
      expect(stored.attachments[0]!.id).toBe("share-old:file:0");
    },
  );
});
