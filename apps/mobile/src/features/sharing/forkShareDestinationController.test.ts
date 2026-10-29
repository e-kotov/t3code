import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  mergeComposerDraftContentState,
  type ComposerDraft,
} from "../../state/use-composer-drafts";
import type { ShareImportDeps } from "../threads/incomingShareImport";
import { IncomingShareInbox } from "./incoming-share-inbox";
import { forkShareSubmissionBlocked, forkShareSubmissionKeys } from "./forkShareSubmissionLock";
import { decodeIncomingShareDraft, type IncomingShareDraft } from "./incoming-share-model";
import {
  filterForkShareThreads,
  makeForkShareDestinationController,
  type ForkShareThread,
} from "./forkShareDestinationController";

const current: ForkShareThread = {
  environmentId: "phone",
  projectId: "project",
  threadId: "current",
  title: "Current",
  projectName: "Fleet",
  environmentName: "Phone",
  updatedAt: "2026-10-29",
};
const other: ForkShareThread = {
  ...current,
  threadId: "other",
  title: "Another conversation",
  updatedAt: "2026-10-28",
};
const shared: IncomingShareDraft = {
  schemaVersion: 1,
  id: "share",
  createdAt: "2026-10-29",
  text: "Transcript",
  attachments: [
    {
      type: "file",
      id: "txt",
      name: "Transcript.txt",
      fileUri: "file:///owned/transcript.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
    },
  ],
  warnings: [],
};

async function setup(
  initial: IncomingShareDraft = shared,
  hydration = Promise.resolve(),
  skipPreparation = false,
) {
  const registry = AtomRegistry.make();
  const stored = new Map([[initial.id, initial]]);
  let drafts: Record<string, ComposerDraft> = {
    "phone:current": { text: "My current draft", attachments: [] },
    "phone:other": { text: "My other draft", attachments: [] },
  };
  const inbox = new IncomingShareInbox({
    loadDrafts: async () => [...stored.values()],
    writeDraft: async (draft) => {
      stored.set(draft.id, decodeIncomingShareDraft(JSON.parse(JSON.stringify(draft))));
    },
    removeDraft: async (id) => {
      stored.delete(id);
    },
    getPayloads: () => [],
    clearPayloads: () => {},
    buildDraft: async () => {
      throw new Error("Not used");
    },
    idForPayloads: async () => "share",
    now: () => "2026-10-29",
  });
  const deps: ShareImportDeps = {
    registry,
    getShare: (id) => stored.get(id) ?? null,
    reserve: async (id, destination) => controller.present(await inbox.reserve(id, destination)),
    release: async (id, destination) =>
      controller.present(await inbox.releaseReservation(id, destination)),
    consume: vi.fn(async (id) => controller.present(await inbox.consume(id))),
    readDraft: (key) => drafts[key] ?? { text: "", attachments: [] },
    mergeIntoDraft: vi.fn(async (key, content) => {
      drafts = mergeComposerDraftContentState(drafts, key, content);
      return { skippedAttachmentCount: 0 };
    }),
    undoMerge: vi.fn(async () => {}),
    selectAttachments: (share) => ({
      status: "ready",
      attachments: share.attachments,
      warnings: [],
    }),
    releaseUnusedAttachments: vi.fn(),
    onWarnings: vi.fn(),
    onImportFailure: vi.fn(),
    onCancelFailure: vi.fn(),
    leave: vi.fn(),
  };
  const openThread = vi.fn();
  const openNew = vi.fn();
  const validate = vi.fn();
  const controller = makeForkShareDestinationController({
    imports: deps,
    waitForDrafts: () => hydration,
    currentThread: () => current,
    draftKey: (destination) => `${destination.environmentId}:${destination.threadId}`,
    validate,
    openThread,
    openNew,
  });
  controller.present([initial]);
  if (!skipPreparation) await controller.prepared();
  return {
    controller,
    deps,
    inbox,
    stored,
    openThread,
    openNew,
    validate,
    draft: (key: string) => drafts[key],
    setDraft: (key: string, draft: ComposerDraft) => {
      drafts[key] = draft;
    },
    dispose: () => registry.dispose(),
  };
}

describe("Android share destinations", () => {
  it.each([current, other])(
    "imports into $threadId without replacing other unsent content",
    async (destination) => {
      const test = await setup();
      try {
        expect(test.controller.getSnapshot()?.current).toEqual(current);
        await test.controller.choose(destination);
        expect(test.draft(`phone:${destination.threadId}`)?.text).toContain(
          destination === current ? "My current draft" : "My other draft",
        );
        expect(test.draft(`phone:${destination.threadId}`)?.text).toContain("Transcript");
        expect(test.draft(`phone:${destination.threadId}`)?.attachments).toEqual(
          shared.attachments,
        );
        expect(
          test.draft(`phone:${destination === current ? "other" : "current"}`)?.attachments,
        ).toEqual([]);
        expect(test.openThread).toHaveBeenCalledExactlyOnceWith(destination);
        expect(test.openNew).not.toHaveBeenCalled();
        expect(test.stored.size).toBe(0);
        expect(test.controller.getSnapshot()).toBeNull();
      } finally {
        test.dispose();
      }
    },
  );

  it("keeps the new-conversation path and ignores replays while it owns the share", async () => {
    const test = await setup();
    try {
      test.controller.newConversation();
      test.controller.present([shared]);
      expect(test.openNew).toHaveBeenCalledExactlyOnceWith(shared.id);
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      expect(test.controller.getSnapshot()).toBeNull();
      expect(test.stored.size).toBe(1);
    } finally {
      test.dispose();
    }
  });

  it("persists the exact thread reservation and retries a failed acknowledgement without duplicating", async () => {
    const test = await setup();
    const consume = test.deps.consume;
    vi.mocked(consume).mockRejectedValueOnce(new Error("Disk busy"));
    try {
      await test.controller.choose(other);
      expect(test.stored.get(shared.id)?.destination).toEqual({
        environmentId: other.environmentId,
        projectId: other.projectId,
        threadId: other.threadId,
      });
      expect(test.controller.getSnapshot()?.error).toBe("Disk busy");
      await expect(test.inbox.reserve(shared.id, current)).rejects.toThrow("reserved");
      await expect(test.inbox.releaseReservation(shared.id, current)).rejects.toThrow(
        "reservation changed",
      );
      await test.controller.choose(current);
      test.controller.newConversation();
      expect(test.deps.mergeIntoDraft).toHaveBeenCalledTimes(1);
      await test.controller.retry();
      expect(test.draft("phone:other")?.attachments).toEqual(shared.attachments);
      expect(test.draft("phone:other")?.importedShareIds).toEqual([shared.id]);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(other);
      expect(test.openNew).not.toHaveBeenCalled();
    } finally {
      test.dispose();
    }
  });

  it("resumes a persisted thread reservation only in that thread", async () => {
    const test = await setup({ ...shared, destination: other });
    try {
      await test.controller.choose(current);
      test.controller.newConversation();
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      await test.controller.choose(other);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(other);
    } finally {
      test.dispose();
    }
  });

  it("returns old project reservations to their original new-conversation flow", async () => {
    const test = await setup({
      ...shared,
      destination: { environmentId: current.environmentId, projectId: current.projectId },
    });
    try {
      expect(test.openNew).toHaveBeenCalledExactlyOnceWith(shared.id);
      expect(test.controller.getSnapshot()).toBeNull();
    } finally {
      test.dispose();
    }
  });

  it("keeps a dismissed share accessible without letting stale dismissals close it", async () => {
    const test = await setup();
    try {
      test.controller.close(shared.id);
      expect(test.stored.size).toBe(1);
      test.controller.present([shared, { ...shared, id: "second" }]);
      expect(test.controller.getSnapshot()?.share.id).toBe(shared.id);
      expect(test.controller.getSnapshot()?.visible).toBe(false);
      test.controller.reopen();
      expect(test.controller.getSnapshot()?.visible).toBe(true);
      test.controller.close("second");
      expect(test.controller.getSnapshot()?.visible).toBe(true);
    } finally {
      test.dispose();
    }
  });

  it("does not import into an unavailable conversation or one editing a queued message", async () => {
    const test = await setup();
    test.validate.mockImplementation(() => {
      throw new Error("Finish editing the queued message first.");
    });
    try {
      await test.controller.choose(current);
      expect(test.controller.getSnapshot()?.error).toContain("Finish editing");
      expect(test.stored.get(shared.id)?.destination).toBeUndefined();
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      expect(test.deps.consume).not.toHaveBeenCalled();
    } finally {
      test.dispose();
    }
  });

  it("searches titles and project names and orders most recent first", () => {
    expect(filterForkShareThreads([other, current], "Fleet")).toEqual([current, other]);
    expect(filterForkShareThreads([other, current], "fleet another")).toEqual([other]);
  });

  it("blocks submission while acknowledgement is paused or failed, including after dismissal and restart", async () => {
    const test = await setup();
    let fail!: (error: Error) => void;
    let acknowledgeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      acknowledgeStarted = resolve;
    });
    const acknowledgement = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    vi.mocked(test.deps.consume).mockImplementationOnce(async () => {
      acknowledgeStarted();
      await acknowledgement;
    });
    const keys = () =>
      forkShareSubmissionKeys([...test.stored.values()], test.controller.getTarget()?.draftKey);
    try {
      const importing = test.controller.choose(current);
      await started;
      test.controller.close(shared.id);
      expect(test.controller.getSnapshot()?.visible).toBe(false);
      expect(forkShareSubmissionBlocked(keys(), "phone:current")).toBe(true);
      expect(forkShareSubmissionBlocked(keys(), "phone:other")).toBe(false);
      expect(test.draft("phone:current")?.importedShareIds).toEqual([shared.id]);
      fail(new Error("Disk busy"));
      await importing;
      expect(test.controller.getSnapshot()?.visible).toBe(true);
      expect(forkShareSubmissionBlocked(keys(), "phone:current")).toBe(true);
      expect(
        forkShareSubmissionBlocked(
          forkShareSubmissionKeys([...test.stored.values()]),
          "phone:current",
        ),
      ).toBe(true);
      expect(forkShareSubmissionBlocked(null, "phone:current")).toBe(true);
      await test.controller.keepDraft();
      expect(forkShareSubmissionBlocked(keys(), "phone:current")).toBe(false);
      expect(test.draft("phone:current")?.attachments).toEqual(shared.attachments);
      expect(test.controller.getSnapshot()).toBeNull();
    } finally {
      test.dispose();
    }
  });

  it("can redirect an unmerged reservation whose old conversation disappeared", async () => {
    const test = await setup({ ...shared, destination: current });
    test.validate.mockImplementationOnce(() => {
      throw new Error("Conversation unavailable");
    });
    try {
      await test.controller.choose(current);
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      await test.controller.changeDestination();
      expect(test.stored.get(shared.id)?.destination).toBeUndefined();
      await test.controller.choose(other);
      expect(test.openThread).toHaveBeenCalledExactlyOnceWith(other);
      expect(test.draft("phone:current")?.text).toBe("My current draft");
    } finally {
      test.dispose();
    }
  });

  it("keeps an already-merged recovered draft without requiring the old thread to be online", async () => {
    const test = await setup({ ...shared, destination: current });
    test.setDraft(
      "phone:current",
      mergeComposerDraftContentState(
        { "phone:current": test.draft("phone:current")! },
        "phone:current",
        { text: shared.text, attachments: shared.attachments, sourceShareId: shared.id },
      )["phone:current"]!,
    );
    test.validate.mockImplementation(() => {
      throw new Error("Conversation unavailable");
    });
    try {
      await test.controller.changeDestination();
      expect(test.stored.get(shared.id)?.destination?.threadId).toBe(current.threadId);
      await test.controller.keepDraft();
      expect(test.stored.size).toBe(0);
      expect(test.draft("phone:current")?.attachments).toEqual(shared.attachments);
      expect(test.draft("phone:current")?.text).toContain("My current draft");
      expect(test.openThread).not.toHaveBeenCalled();
    } finally {
      test.dispose();
    }
  });

  it("discards an unimported share without changing either conversation draft", async () => {
    const test = await setup({ ...shared, destination: current });
    try {
      await test.controller.discard();
      expect(test.stored.size).toBe(0);
      expect(test.deps.mergeIntoDraft).not.toHaveBeenCalled();
      expect(test.draft("phone:current")?.text).toBe("My current draft");
      expect(test.draft("phone:other")?.text).toBe("My other draft");
      expect(test.deps.releaseUnusedAttachments).toHaveBeenCalledWith(shared.attachments);
    } finally {
      test.dispose();
    }
  });

  it("waits for an earlier merge receipt to hydrate before offering recovery", async () => {
    let loaded!: () => void;
    const hydration = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const test = await setup({ ...shared, destination: current }, hydration, true);
    try {
      expect(test.controller.getSnapshot()?.loadingDrafts).toBe(true);
      await test.controller.changeDestination();
      await test.controller.discard();
      expect(test.stored.get(shared.id)?.destination?.threadId).toBe(current.threadId);
      test.setDraft("phone:current", {
        text: "Saved before restart",
        attachments: shared.attachments,
        importedShareIds: [shared.id],
      });
      loaded();
      await test.controller.prepared();
      expect(test.controller.getSnapshot()?.loadingDrafts).toBe(false);
      expect(test.controller.recovery().merged).toBe(true);
      await test.controller.changeDestination();
      expect(test.stored.get(shared.id)?.destination?.threadId).toBe(current.threadId);
      await test.controller.keepDraft();
      expect(test.draft("phone:current")?.text).toBe("Saved before restart");
      expect(test.draft("phone:current")?.attachments).toEqual(shared.attachments);
      expect(test.stored.size).toBe(0);
    } finally {
      loaded();
      test.dispose();
    }
  });
});
