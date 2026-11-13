import type { SidebarListItem } from "../Sidebar.logic";

export function arrangeWorkingSidebarItems(
  items: readonly SidebarListItem[],
  workingFirst: boolean,
): readonly SidebarListItem[] {
  if (!workingFirst) return items;
  const start = items.findIndex((item) => item.kind === "marker" && item.marker === "working-header");
  const target = items.findIndex((item) => item.kind === "marker" && item.marker === "pinned-divider");
  if (start < 0 || target < 0) return items;
  const following = items.findIndex(
    (item, index) =>
      index > start &&
      item.kind === "marker" &&
      (item.marker === "snoozed-header" || item.marker === "settled-header"),
  );
  const end = following < 0 ? items.length : following;
  return [...items.slice(0, target), ...items.slice(start, end), ...items.slice(target, start), ...items.slice(end)];
}
