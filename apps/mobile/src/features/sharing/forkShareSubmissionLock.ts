import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../../state/atom-registry";
import type { IncomingShareDraft } from "./incoming-share-model";

export function forkShareSubmissionKeys(shares: readonly IncomingShareDraft[], activeDraftKey?: string) {
  const keys = new Set(shares.flatMap((share) => share.destination?.threadId ? [`${share.destination.environmentId}:${share.destination.threadId}`] : []));
  if (activeDraftKey) keys.add(activeDraftKey);
  return keys;
}

export const forkShareSubmissionLocksAtom = Atom.make<ReadonlySet<string> | null>(new Set<string>()).pipe(Atom.keepAlive);

export function forkShareSubmissionBlocked(keys: ReadonlySet<string> | null, draftKey: string) {
  return keys === null || keys.has(draftKey);
}

export function isForkShareSubmissionLocked(draftKey: string) {
  return forkShareSubmissionBlocked(appAtomRegistry.get(forkShareSubmissionLocksAtom), draftKey);
}

export function useForkShareSubmissionLocked(draftKey: string) {
  return forkShareSubmissionBlocked(useAtomValue(forkShareSubmissionLocksAtom), draftKey);
}
