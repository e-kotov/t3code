import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";

export interface SidebarProjectRefLike {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
}

export interface SidebarProjectGroupLike {
  readonly projectKey: string;
  readonly memberProjectRefs: ReadonlyArray<SidebarProjectRefLike>;
}

export interface SidebarNonSettledCounts {
  readonly totalNonSettled: number;
  readonly byMachine: ReadonlyMap<EnvironmentId, number>;
  readonly byProjectScopeKey: ReadonlyMap<string, number>;
  readonly machineSummary: string;
  readonly projectSummary: string;
}

export function computeSidebarNonSettledCounts(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  delegatedUnderParent: ReadonlySet<string>,
  projectGroups: ReadonlyArray<SidebarProjectGroupLike>,
): SidebarNonSettledCounts {
  let totalNonSettled = 0;
  const byMachine = new Map<EnvironmentId, number>();
  const byProjectScopeKey = new Map<string, number>();

  const projectKeyByMemberRef = new Map<string, string>();
  for (const group of projectGroups) {
    for (const ref of group.memberProjectRefs) {
      projectKeyByMemberRef.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
    }
  }

  for (const thread of threads) {
    if (
      thread.archivedAt !== null ||
      isShownUnderParent(
        { environmentId: thread.environmentId, threadId: thread.id },
        thread.lineage,
        delegatedUnderParent,
      ) ||
      thread.settledOverride === "settled"
    ) {
      continue;
    }

    totalNonSettled += 1;
    byMachine.set(thread.environmentId, (byMachine.get(thread.environmentId) ?? 0) + 1);

    if (thread.projectId) {
      const projectKey = projectKeyByMemberRef.get(`${thread.environmentId}:${thread.projectId}`);
      if (projectKey) {
        byProjectScopeKey.set(projectKey, (byProjectScopeKey.get(projectKey) ?? 0) + 1);
      }
    }
  }

  const machineCountWithActive = byMachine.size;
  const projectCountWithActive = byProjectScopeKey.size;

  return {
    totalNonSettled,
    byMachine,
    byProjectScopeKey,
    machineSummary: `${machineCountWithActive} ${machineCountWithActive === 1 ? "machine" : "machines"} · ${totalNonSettled} active`,
    projectSummary: `${projectCountWithActive} ${projectCountWithActive === 1 ? "project" : "projects"} · ${totalNonSettled} active`,
  };
}

export function getProjectScopeItemNonSettledCount(
  item: {
    readonly kind: string;
    readonly environmentId?: EnvironmentId | null;
    readonly value: string;
  },
  counts: SidebarNonSettledCounts,
): number {
  if (item.kind === "machine") {
    return item.environmentId == null
      ? counts.totalNonSettled
      : (counts.byMachine.get(item.environmentId) ?? 0);
  }
  if (item.kind === "project") {
    return item.value === "all"
      ? counts.totalNonSettled
      : (counts.byProjectScopeKey.get(item.value) ?? 0);
  }
  return 0;
}

export function ProjectScopeNonSettledBadge({ count }: { readonly count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
      {count}
    </span>
  );
}
