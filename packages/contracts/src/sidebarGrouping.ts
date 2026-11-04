import type { SidebarConversationGrouping } from "./settings.ts";

export function isSidebarMachineGrouping(grouping: SidebarConversationGrouping): boolean {
  return grouping === "machine" || grouping === "both";
}

export function isSidebarProjectGrouping(grouping: SidebarConversationGrouping): boolean {
  return grouping === "project" || grouping === "both";
}

export function toggleSidebarGroupingDimension(
  current: SidebarConversationGrouping,
  dimension: "machine" | "project",
): SidebarConversationGrouping {
  const machine =
    dimension === "machine"
      ? !isSidebarMachineGrouping(current)
      : isSidebarMachineGrouping(current);
  const project =
    dimension === "project"
      ? !isSidebarProjectGrouping(current)
      : isSidebarProjectGrouping(current);
  if (machine && project) return "both";
  if (machine) return "machine";
  if (project) return "project";
  return "none";
}
