import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedProjectKey } from "../../lib/scopedEntities";

export interface MobileNonSettledCounts {
  readonly totalNonSettled: number;
  readonly byEnvironment: ReadonlyMap<string, number>;
  readonly byProjectScopeKey: ReadonlyMap<string, number>;
  readonly machineSummary: string;
}

export interface MobileProjectScopeLike {
  readonly key: string;
  readonly title: string;
  readonly projectRefs: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }>;
}

export function computeMobileNonSettledCounts(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  projectScopes: ReadonlyArray<MobileProjectScopeLike>,
): MobileNonSettledCounts {
  let totalNonSettled = 0;
  const byEnvironment = new Map<string, number>();
  const byProjectScopeKey = new Map<string, number>();

  const projectKeyByScopedRef = new Map<string, string>();
  for (const scope of projectScopes) {
    for (const ref of scope.projectRefs) {
      projectKeyByScopedRef.set(scopedProjectKey(ref.environmentId, ref.projectId), scope.key);
    }
  }

  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.settledOverride === "settled") {
      continue;
    }
    totalNonSettled += 1;
    const envId = String(thread.environmentId);
    byEnvironment.set(envId, (byEnvironment.get(envId) ?? 0) + 1);

    if (thread.projectId) {
      const projectKey = projectKeyByScopedRef.get(
        scopedProjectKey(thread.environmentId, thread.projectId),
      );
      if (projectKey) {
        byProjectScopeKey.set(projectKey, (byProjectScopeKey.get(projectKey) ?? 0) + 1);
      }
    }
  }

  const machineCountWithActive = byEnvironment.size;
  return {
    totalNonSettled,
    byEnvironment,
    byProjectScopeKey,
    machineSummary: `${machineCountWithActive} ${machineCountWithActive === 1 ? "machine" : "machines"} · ${totalNonSettled} active`,
  };
}

export function formatFilterOptionTitle(label: string, count?: number): string {
  return count !== undefined && count > 0 ? `${label} (${count})` : label;
}

export function formatFilterOptionSubtitle(count?: number): string | undefined {
  return count !== undefined && count > 0 ? `${count} active` : undefined;
}
