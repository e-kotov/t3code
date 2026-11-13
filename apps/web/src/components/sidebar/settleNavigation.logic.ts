import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";

type Navigation = (() => void) | null;
type ThreadProject = { readonly environmentId: EnvironmentId; readonly projectId: ProjectId };

export interface SettleNavigationTargets {
  /** The upstream settle-and-advance plan; null when the settled thread is not the open one. */
  readonly planForwardNavigation: (
    threadKey: string,
    coSettlingKeys?: ReadonlySet<string>,
  ) => Navigation;
  readonly threadByKeyRef: { readonly current: ReadonlyMap<string, ThreadProject> };
  readonly handleNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>;
}

/** Where the route goes after the open thread settles; background settles never navigate. */
export function planSettleNavigation(
  mode: ClientSettings["settleNavigation"],
  targets: SettleNavigationTargets,
  threadKey: string,
  coSettlingKeys?: ReadonlySet<string>,
): Navigation {
  if (mode === "stay") return null;
  const forward = targets.planForwardNavigation(threadKey, coSettlingKeys);
  if (forward === null || mode === "next-thread") return forward;
  const shell = targets.threadByKeyRef.current.get(threadKey);
  return shell
    ? () => void targets.handleNewThread(scopeProjectRef(shell.environmentId, shell.projectId))
    : null;
}
