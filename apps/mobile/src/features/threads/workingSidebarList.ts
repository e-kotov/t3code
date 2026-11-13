import { orderWorkingSections } from "@t3tools/client-runtime/state/working-sidebar-view";
import type { ThreadListV2ListItem, ThreadListV2ThreadListItem } from "./threadListV2";

type WorkingSidebarListItem = ThreadListV2ListItem & { readonly workingDivider?: boolean };

export function hasWorkingDivider(item: ThreadListV2ThreadListItem): boolean {
  return "workingDivider" in item && item.workingDivider === true;
}

export function arrangeWorkingSidebarList(
  items: readonly ThreadListV2ListItem[],
  workingFirst: boolean,
): readonly ThreadListV2ListItem[] {
  const start = items.findIndex((item) => item.type === "v2-working-shelf");
  if (!workingFirst || start < 0) return items;
  let end = start + 1;
  while (items[end]?.type === "v2-thread") end += 1;
  let insertion = 0;
  for (const item of items) {
    if (item.type !== "v2-pending" && !(item.type === "v2-thread" && item.item.pinned)) break;
    insertion += 1;
  }
  const main = items.slice(insertion, start);
  const [first, ...rest] = main;
  return [
    ...items.slice(0, insertion),
    ...orderWorkingSections<WorkingSidebarListItem>(
      first?.type === "v2-thread"
        ? [{ ...first, key: `${first.key}:after-working`, workingDivider: true }, ...rest]
        : main,
      items.slice(start, end),
      workingFirst,
    ),
    ...items.slice(end),
  ];
}
