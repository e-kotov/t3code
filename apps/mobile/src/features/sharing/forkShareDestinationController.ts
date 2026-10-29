import { makeIncomingShareImports, type ShareImportDeps, type ShareImportTarget } from "../threads/incomingShareImport";
import type { IncomingShareDestination, IncomingShareDraft } from "./incoming-share-model";
import { sameForkShareDestination } from "./forkShareDestination";

export interface ForkShareThread extends IncomingShareDestination {
  readonly threadId: string;
  readonly title: string;
  readonly projectName: string;
  readonly updatedAt: string;
}

export interface ForkShareDestinationSnapshot {
  readonly share: IncomingShareDraft;
  readonly current: ForkShareThread | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly retryAvailable: boolean;
  readonly visible: boolean;
}

export function filterForkShareThreads(threads: readonly ForkShareThread[], query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/);
  return threads.filter((thread) => words.every((word) =>
    `${thread.title} ${thread.projectName}`.toLocaleLowerCase().includes(word),
  )).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function makeForkShareDestinationController(options: {
  readonly imports: ShareImportDeps;
  readonly currentThread: () => ForkShareThread | null;
  readonly draftKey: (destination: IncomingShareDestination) => string;
  readonly validate: (destination: IncomingShareDestination) => void;
  readonly openThread: (destination: IncomingShareDestination) => void;
  readonly openNew: (shareId: string) => void;
}) {
  let snapshot: ForkShareDestinationSnapshot | null = null;
  let drafts: readonly IncomingShareDraft[] = [];
  let target: ShareImportTarget | null = null;
  const handedOff = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const manager = makeIncomingShareImports({
    ...options.imports,
    mergeIntoDraft: (key, content) => {
      if (!target) throw new Error("Choose a conversation before importing.");
      options.validate(target.destination);
      return options.imports.mergeIntoDraft(key, content);
    },
    onImportFailure: (_target, error) => {
      if (snapshot) {
        snapshot = { ...snapshot, busy: false, visible: true, error: error instanceof Error ? error.message : "The shared content could not be saved." };
        notify();
      }
    },
  });

  function present(next: readonly IncomingShareDraft[]) {
    drafts = next;
    const live = new Set(next.map((share) => share.id));
    for (const id of handedOff) if (!live.has(id)) handedOff.delete(id);
    if (snapshot) {
      const refreshed = next.find((share) => share.id === snapshot?.share.id);
      if (refreshed && refreshed !== snapshot.share) {
        snapshot = { ...snapshot, share: refreshed };
        notify();
      }
      return;
    }
    const share = next.find((candidate) => !handedOff.has(candidate.id));
    if (!share) return;
    // Project-only reservations belong to the existing new-conversation flow.
    if (share.destination && !share.destination.threadId) {
      handedOff.add(share.id);
      options.openNew(share.id);
      return;
    }
    target = null;
    snapshot = { share, current: options.currentThread(), busy: false, error: null, retryAvailable: false, visible: true };
    notify();
  }

  async function finishAttempt() {
    if (!target) return;
    const importing = target;
    await manager.settled(importing);
    if (options.imports.registry.get(manager.phaseAtom(importing)) !== "done") return;
    options.openThread(importing.destination);
    snapshot = null;
    target = null;
    await manager.prune(new Set());
    notify();
    present(drafts);
  }

  return {
    present,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close(shareId: string) {
      if (!snapshot || snapshot.share.id !== shareId) return;
      if (snapshot.busy) {
        snapshot = { ...snapshot, visible: false };
        notify();
        return;
      }
      handedOff.add(snapshot.share.id);
      snapshot = null;
      target = null;
      notify();
      present(drafts);
    },
    newConversation() {
      if (!snapshot || snapshot.busy || snapshot.share.destination) return;
      const id = snapshot.share.id;
      handedOff.add(id);
      snapshot = null;
      notify();
      options.openNew(id);
    },
    async choose(destination: IncomingShareDestination) {
      if (!snapshot || snapshot.busy || !destination.threadId) return;
      if (snapshot.share.destination && !sameForkShareDestination(snapshot.share.destination, destination)) return;
      try { options.validate(destination); } catch (error) {
        snapshot = { ...snapshot, error: error instanceof Error ? error.message : "That conversation is unavailable." };
        notify();
        return;
      }
      target = {
        flowKey: `fork-share:${snapshot.share.id}`, routeKey: `fork-share:${snapshot.share.id}`,
        draftKey: options.draftKey(destination), destination, shareId: snapshot.share.id,
      };
      snapshot = { ...snapshot, busy: true, error: null, retryAvailable: true };
      notify();
      if (options.imports.registry.get(manager.phaseAtom(target)) === "failed") manager.retry(target);
      await finishAttempt();
    },
    async retry() {
      if (!snapshot || snapshot.busy || !target) return;
      snapshot = { ...snapshot, busy: true, error: null };
      notify();
      manager.retry(target);
      await finishAttempt();
    },
  };
}
