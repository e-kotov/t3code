import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { Platform } from "react-native";
import { environmentCatalog } from "../../connection/catalog";
import { forkShareSubmissionKeys, forkShareSubmissionLocksAtom } from "./forkShareSubmissionLock";

import { rootNavigationRef } from "../../lib/rootNavigation";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import { getQueuedRunEdit } from "../../state/queued-run-edit";
import { environmentThreadShells } from "../../state/threads";
import { selectWorkspaceDetail } from "../workspace/workspace-detail-selection";
import { makeIncomingShareImports, type ShareImportDeps } from "../threads/incomingShareImport";
import type { IncomingShareDestination, IncomingShareDraft } from "./incoming-share-model";
import {
  makeForkShareDestinationController,
  type ForkShareThread,
} from "./forkShareDestinationController";

export const forkShareThreadsAtom = Atom.make((get): readonly ForkShareThread[] =>
  get(environmentThreadShells.quietThreadShellsAtom)
    .filter((thread) => thread.archivedAt === null)
    .map((thread) => ({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      threadId: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      projectName:
        get(
          environmentProjects.projectAtom({
            environmentId: thread.environmentId,
            projectId: thread.projectId,
          }),
        )?.name ?? "Project",
      environmentName: get(environmentCatalog.catalogValueAtom).entries.get(thread.environmentId)?.target.label ?? thread.environmentId,
    })),
);

export function forkShareDraftKey(destination: IncomingShareDestination) {
  return scopedThreadKey(
    EnvironmentId.make(destination.environmentId),
    ThreadId.make(destination.threadId!),
  );
}

function currentThread(): ForkShareThread | null {
  const state = rootNavigationRef.getRootState();
  const route = state.routes
    .slice(0, state.index + 1)
    .findLast((candidate) => candidate.name === "Thread");
  const params = route?.params as
    | { environmentId?: string; threadId?: string; draft?: unknown }
    | undefined;
  if (params?.draft || !params?.environmentId || !params.threadId) return null;
  return (
    appAtomRegistry
      .get(forkShareThreadsAtom)
      .find(
        (thread) =>
          thread.environmentId === params.environmentId && thread.threadId === params.threadId,
      ) ?? null
  );
}

function validate(destination: IncomingShareDestination) {
  const shell = appAtomRegistry.get(
    environmentThreadShells.threadShellAtom({
      environmentId: EnvironmentId.make(destination.environmentId),
      threadId: ThreadId.make(destination.threadId!),
    }),
  );
  if (!shell || shell.projectId !== destination.projectId || shell.archivedAt !== null) {
    throw new Error("That conversation is unavailable. Reconnect to its server and try again.");
  }
  if (
    !appAtomRegistry.get(
      environmentProjects.projectAtom({
        environmentId: EnvironmentId.make(destination.environmentId),
        projectId: ProjectId.make(destination.projectId),
      }),
    )
  ) {
    throw new Error("That conversation’s project is unavailable.");
  }
  if (getQueuedRunEdit(forkShareDraftKey(destination))) {
    throw new Error("Finish editing the queued message in that conversation, then try again.");
  }
}

export let forkShareDestinations: ReturnType<typeof makeForkShareDestinationController> | null =
  null;

export function makeForkIncomingShareImports(deps: ShareImportDeps) {
  forkShareDestinations = makeForkShareDestinationController({
    imports: deps,
    currentThread,
    validate,
    draftKey: forkShareDraftKey,
    openThread: (destination) =>
      rootNavigationRef.dispatch(
        selectWorkspaceDetail({
          name: "Thread",
          params: { environmentId: destination.environmentId, threadId: destination.threadId! },
        }),
      ),
    openNew: (shareId) =>
      rootNavigationRef.dispatch(
        selectWorkspaceDetail({ name: "Thread", params: { draft: { incomingShareId: shareId } } }),
      ),
  });
  if (Platform.OS === "android") {
    appAtomRegistry.set(forkShareSubmissionLocksAtom, null);
    forkShareDestinations.subscribe(refreshLocks);
  }
  return makeIncomingShareImports(deps);
}

let latestShares: readonly IncomingShareDraft[] | null = null;
function refreshLocks() {
  if (latestShares === null) return;
  const target = forkShareDestinations?.getTarget();
  const keys = forkShareSubmissionKeys(latestShares, target?.draftKey);
  appAtomRegistry.set(forkShareSubmissionLocksAtom, keys);
}

export function presentForkShareDestinations(drafts: readonly IncomingShareDraft[]) {
  if (Platform.OS !== "android" || !forkShareDestinations) return false;
  latestShares = drafts;
  forkShareDestinations.present(drafts);
  refreshLocks();
  return true;
}
