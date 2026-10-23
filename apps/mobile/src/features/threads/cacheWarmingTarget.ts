import type { EnvironmentId } from "@t3tools/contracts";

/**
 * The machine an environment-wide warming switch acts on: the filtered environment, otherwise
 * the first by name. The Home list and the sidebar both use this, so the same switch never
 * targets a different machine after a fold or layout change.
 */
export function resolveCacheWarmingEnvironmentId(
  selectedEnvironmentId: EnvironmentId | null,
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>,
): EnvironmentId | null {
  if (selectedEnvironmentId !== null) return selectedEnvironmentId;
  const [first] = [...environments].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.environmentId.localeCompare(right.environmentId),
  );
  return first?.environmentId ?? null;
}
