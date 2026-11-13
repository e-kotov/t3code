import { EnvironmentId, type ScopedProjectRef } from "@t3tools/contracts";

export type SidebarMachineScope = string | readonly string[] | null;

export function normalizeSidebarMachineScope(value: unknown): SidebarMachineScope {
  if (typeof value === "string") return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const ids = [
    ...new Set(
      value
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  return ids.length > 1 ? ids : (ids[0] ?? null);
}

export function sidebarMachineScopeIds(value: SidebarMachineScope): readonly EnvironmentId[] {
  return (value === null ? [] : typeof value === "string" ? [value] : value).map((id) =>
    EnvironmentId.make(id),
  );
}

export function toggleSidebarMachineScope(ids: readonly EnvironmentId[], id: EnvironmentId) {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function sidebarMachineScopeIncludes(ids: readonly EnvironmentId[], id: EnvironmentId) {
  return ids.length === 0 || ids.includes(id);
}

export function scopeSidebarProjectKeysToEnvironments(
  projectKeys: ReadonlySet<string> | null,
  environmentIds: readonly EnvironmentId[],
  projectRefs: readonly ScopedProjectRef[],
): ReadonlySet<string> | null {
  if (environmentIds.length === 0) return projectKeys;
  return new Set(
    projectRefs.flatMap((ref) => {
      const key = `${ref.environmentId}:${ref.projectId}`;
      return environmentIds.includes(ref.environmentId) &&
        (projectKeys === null || projectKeys.has(key))
        ? [key]
        : [];
    }),
  );
}
