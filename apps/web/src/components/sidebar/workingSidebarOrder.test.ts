import { describe, expect, it } from "vite-plus/test";
import { resolveSidebarDropTarget, type SidebarListItem } from "../Sidebar.logic";
import { arrangeWorkingSidebarItems } from "./workingSidebarOrder";

describe("Working shelf placement", () => {
  it("keeps drop orders complete when Working separates pinned and active rows", () => {
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      { kind: "thread", key: "pin", section: "pinned" },
      { kind: "marker", marker: "working-header" },
      { kind: "thread", key: "working", section: "working" },
      { kind: "marker", marker: "pinned-divider" },
      { kind: "thread", key: "main-one", section: "active" },
      { kind: "thread", key: "main-two", section: "active" },
      { kind: "marker", marker: "settled-header" },
      { kind: "thread", key: "settled", section: "settled" },
    ];
    expect(resolveSidebarDropTarget(items, "pin", "main-one")).toEqual({
      section: "active",
      pinnedOrder: [],
      activeOrder: ["main-one", "pin", "main-two"],
    });
    expect(resolveSidebarDropTarget(items, "settled", "main-one")).toEqual({
      section: "active",
      pinnedOrder: ["pin"],
      activeOrder: ["settled", "main-one", "main-two"],
    });
  });

  it("keeps pinned first, moves the complete Working shelf above Main, and leaves parked shelves last", () => {
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      { kind: "thread", key: "pin", section: "pinned" },
      { kind: "marker", marker: "pinned-divider" },
      { kind: "marker", marker: "active-placeholder" },
      { kind: "thread", key: "main", section: "active" },
      { kind: "marker", marker: "working-header" },
      { kind: "thread", key: "working-one", section: "working" },
      { kind: "thread", key: "working-two", section: "working" },
      { kind: "marker", marker: "snoozed-header" },
      { kind: "thread", key: "snoozed", section: "snoozed" },
      { kind: "marker", marker: "settled-header" },
    ];
    const expected = [0, 1, 5, 6, 7, 2, 3, 4, 8, 9, 10].map((index) => items[index]);
    expect(arrangeWorkingSidebarItems(items, true)).toEqual(expected);
    expect(arrangeWorkingSidebarItems(items, false)).toBe(items);
    const withoutWorking = items.filter(
      (item) =>
        !(item.kind === "thread" && item.section === "working") &&
        !(item.kind === "marker" && item.marker === "working-header"),
    );
    expect(arrangeWorkingSidebarItems(withoutWorking, true)).toBe(withoutWorking);
  });
});
