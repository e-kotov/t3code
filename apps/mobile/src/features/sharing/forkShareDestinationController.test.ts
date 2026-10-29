import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { mergeComposerDraftContentState, type ComposerDraft } from "../../state/use-composer-drafts";
import type { ShareImportDeps } from "../threads/incomingShareImport";
import { IncomingShareInbox } from "./incoming-share-inbox";
import { decodeIncomingShareDraft, type IncomingShareDraft } from "./incoming-share-model";
import { filterForkShareThreads, makeForkShareDestinationController, type ForkShareThread } from "./forkShareDestinationController";

const current: ForkShareThread = {environmentId: "phone", projectId: "project", threadId: "current", title: "Current", projectName: "Fleet", updatedAt: "2026-10-29"};
const other: ForkShareThread = {...current, threadId: "other", title: "Another conversation", updatedAt: "2026-10-28"};
const shared: IncomingShareDraft = {schemaVersion: 1, id: "share", createdAt: "2026-10-29", text: "Transcript", attachments: [{type: "file", id: "txt", name: "Transcript.txt", fileUri: "file:///owned/transcript.txt", mimeType: "text/plain", sizeBytes: 10}], warnings: []};

function setup(initial: IncomingShareDraft = shared) {
  const registry = AtomRegistry.make();
  const stored = new Map([[initial.id, initial]]);
  let drafts: Record<string, ComposerDraft> = {
    "phone:current": {text: "My current draft", attachments: []},
    "phone:other": {text: "My other draft", attachments: []},
  };
  const inbox = new IncomingShareInbox({loadDrafts: async () => [...stored.values()], writeDraft: async (draft) => {stored.set(draft.id, decodeIncomingShareDraft(JSON.parse(JSON.stringify(draft))));}, removeDraft: async (id) => {stored.delete(id);}, getPayloads: () => [], clearPayloads: () => {}, buildDraft: async () => {throw new Error("Not used");}, idForPayloads: async () => "share", now: () => "2026-10-29"});
  const deps: ShareImportDeps = {
    registry, getShare: (id) => stored.get(id) ?? null,
    reserve: async (id, destination) => controller.present(await inbox.reserve(id, destination)),
    release: async (id, destination) => controller.present(await inbox.releaseReservation(id, destination)),
    consume: vi.fn(async (id) => controller.present(await inbox.consume(id))),
    readDraft: (key) => drafts[key] ?? {text: "", attachments: []},
    mergeIntoDraft: vi.fn(async (key, content) => {drafts = mergeComposerDraftContentState(drafts, key, content); return {skippedAttachmentCount: 0};}),
    undoMerge: vi.fn(async () => {}),
    selectAttachments: (share) => ({status: "ready", attachments: share.attachments, warnings: []}),
    releaseUnusedAttachments: vi.fn(), onWarnings: vi.fn(), onImportFailure: vi.fn(), onCancelFailure: vi.fn(), leave: vi.fn(),
  };
  const openThread = vi.fn();
  const openNew = vi.fn();
  const validate = vi.fn();
  const controller = makeForkShareDestinationController({imports: deps, currentThread: () => current, draftKey: (destination) => `${destination.environmentId}:${destination.threadId}`, validate, openThread, openNew});
  controller.present([initial]);
  return {controller, deps, inbox, stored, openThread, openNew, validate, draft: (key: string) => drafts[key], dispose: () => registry.dispose()};
}

describe("Android share destinations", () => {
  it.each([current, other])("imports into $threadId without replacing other unsent content", async (destination) => {
    const test = setup();
    try {
      expect(test.controller.getSnapshot()?.current).toEqual(current);
      await test.controller.choose(destination);
      expect(test.draft(`phone:${destination.threadId}`)?.text).toContain(destination === current ? "My current draft" : "My other draft");
      expect(test.draft(`phone:${destination.threadId}`)?.text).toContain("Transcript");
      expect(test.draft(`phone:${destination.threadId}`)?.attachments).toEqual(shared.attachments);
      expect(test.draft(`phone:${destination === current ? "other" : "current"}`)?.attachments).toEqual([]);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(destination);
      expect(test.openNew).not.toHaveBeenCalled();
      expect(test.stored.size).toBe(0);
      expect(test.controller.getSnapshot()).toBeNull();
    } finally {test.dispose();}
  });

  it("keeps the new-conversation path and ignores replays while it owns the share", () => {
    const test = setup();
    try {
      test.controller.newConversation();
      test.controller.present([shared]);
      expect(test.openNew).toHaveBeenCalledExactlyOnceWith(shared.id);
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      expect(test.controller.getSnapshot()).toBeNull();
      expect(test.stored.size).toBe(1);
    } finally {test.dispose();}
  });

  it("persists the exact thread reservation and retries a failed acknowledgement without duplicating", async () => {
    const test = setup();
    const consume = test.deps.consume;
    vi.mocked(consume).mockRejectedValueOnce(new Error("Disk busy"));
    try {
      await test.controller.choose(other);
      expect(test.stored.get(shared.id)?.destination).toEqual(other);
      expect(test.controller.getSnapshot()?.error).toBe("Disk busy");
      await expect(test.inbox.reserve(shared.id, current)).rejects.toThrow("reserved");
      await expect(test.inbox.releaseReservation(shared.id, current)).rejects.toThrow("reservation changed");
      await test.controller.choose(current);
      test.controller.newConversation();
      expect(test.deps.mergeIntoDraft).toHaveBeenCalledTimes(1);
      await test.controller.retry();
      expect(test.draft("phone:other")?.attachments).toEqual(shared.attachments);
      expect(test.draft("phone:other")?.importedShareIds).toEqual([shared.id]);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(other);
      expect(test.openNew).not.toHaveBeenCalled();
    } finally {test.dispose();}
  });

  it("resumes a persisted thread reservation only in that thread", async () => {
    const test = setup({...shared, destination: other});
    try {
      await test.controller.choose(current);
      test.controller.newConversation();
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      await test.controller.choose(other);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(other);
    } finally {test.dispose();}
  });

  it("returns old project reservations to their original new-conversation flow", () => {
    const test = setup({...shared, destination: {environmentId: current.environmentId, projectId: current.projectId}});
    try {
      expect(test.openNew).toHaveBeenCalledExactlyOnceWith(shared.id);
      expect(test.controller.getSnapshot()).toBeNull();
    } finally {test.dispose();}
  });

  it("keeps a dismissed share durable and presents the next handoff", () => {
    const test = setup();
    try {
      test.controller.close(shared.id);
      expect(test.stored.size).toBe(1);
      test.controller.present([shared, {...shared, id: "second"}]);
      expect(test.controller.getSnapshot()?.share.id).toBe("second");
      test.controller.close(shared.id);
      expect(test.controller.getSnapshot()?.share.id).toBe("second");
    } finally {test.dispose();}
  });

  it("does not import into an unavailable conversation or one editing a queued message", async () => {
    const test = setup();
    test.validate.mockImplementation(() => {throw new Error("Finish editing the queued message first.");});
    try {
      await test.controller.choose(current);
      expect(test.controller.getSnapshot()?.error).toContain("Finish editing");
      expect(test.stored.get(shared.id)?.destination).toBeUndefined();
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      expect(test.deps.consume).not.toHaveBeenCalled();
    } finally {test.dispose();}
  });

  it("searches titles and project names and orders most recent first", () => {
    expect(filterForkShareThreads([other, current], "Fleet")).toEqual([current, other]);
    expect(filterForkShareThreads([other, current], "fleet another")).toEqual([other]);
  });
});
