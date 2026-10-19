import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "../Sidebar.logic";
import {
  withConversationSort,
  groupSidebarRowsByMachine,
  moveMachineGroup,
  type SidebarConversationView,
} from "./sidebarConversationGroups";

const local = EnvironmentId.make("env-local");
const alpha = EnvironmentId.make("env-alpha");
const zulu = EnvironmentId.make("env-zulu");

const view = (overrides: Partial<SidebarConversationView> = {}): SidebarConversationView => ({
  sortOrder: "updated_at",
  grouping: "machine",
  machineOrder: [],
  primaryEnvironmentId: local,
  ...overrides,
});

const thread = (id: string, environmentId: EnvironmentId) => ({ id, environmentId });
const rowsOf = (
  list: readonly { readonly id: string }[],
  section: SidebarSection,
): SidebarListItem[] => list.map((item) => ({ kind: "thread", key: item.id, section }));
const layout = (items: readonly SidebarListItem[]) =>
  items.map((item) =>
    item.kind === "thread"
      ? item.key
      : `[${item.environmentId}:${item.groupPosition}/${item.groupCount}]`,
  );

describe("groupSidebarRowsByMachine", () => {
  const threads = [
    thread("z1", zulu),
    thread("l1", local),
    thread("a1", alpha),
    thread("l2", local),
  ];

  it("leaves rows untouched without machine grouping", () => {
    expect(
      layout(groupSidebarRowsByMachine(threads, "active", view({ grouping: "none" }), rowsOf)),
    ).toEqual(["z1", "l1", "a1", "l2"]);
  });

  it("puts the primary machine first, then the rest alphabetically, keeping row order", () => {
    expect(layout(groupSidebarRowsByMachine(threads, "active", view(), rowsOf))).toEqual([
      "[env-local:0/3]",
      "l1",
      "l2",
      "[env-alpha:1/3]",
      "a1",
      "[env-zulu:2/3]",
      "z1",
    ]);
  });

  it("follows the saved order and places unsaved machines after it", () => {
    expect(
      layout(groupSidebarRowsByMachine(threads, "active", view({ machineOrder: [zulu] }), rowsOf)),
    ).toEqual(["[env-zulu:0/3]", "z1", "[env-local:1/3]", "l1", "l2", "[env-alpha:2/3]", "a1"]);
  });

  it("omits the header while only one machine has rows", () => {
    expect(
      layout(
        groupSidebarRowsByMachine(
          [thread("a1", alpha), thread("a2", alpha)],
          "pinned",
          view(),
          rowsOf,
        ),
      ),
    ).toEqual(["a1", "a2"]);
  });

  it("keys headers per shelf so one machine can head several shelves", () => {
    const keys = (section: SidebarSection) =>
      groupSidebarRowsByMachine(threads, section, view(), rowsOf).flatMap((item) =>
        item.kind === "marker" ? [item.key] : [],
      );
    expect(keys("active")[0]).toBe("sidebar-machine:active:env-local");
    expect(keys("working")[0]).toBe("sidebar-machine:working:env-local");
  });
});

describe("machine headers in sidebar drops", () => {
  it("are addressed by their own key and never enter a saved order", () => {
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      ...groupSidebarRowsByMachine(
        [thread("p1", local), thread("p2", alpha)],
        "pinned",
        view(),
        rowsOf,
      ),
      { kind: "marker", marker: "pinned-divider" },
      ...groupSidebarRowsByMachine([thread("a1", local)], "active", view(), rowsOf),
      { kind: "marker", marker: "settled-header" },
    ];
    const alphaHeader = "sidebar-machine:pinned:env-alpha";
    expect(items.map(sidebarListItemId)).toContain(alphaHeader);
    expect(resolveSidebarDropTarget(items, "a1", alphaHeader)).toEqual({
      section: "pinned",
      pinnedOrder: ["p1", "a1", "p2"],
      activeOrder: [],
    });
  });
});

describe("moveMachineGroup", () => {
  const visible = [zulu, local, alpha, local];

  it("saves the whole visible order with the moved machine swapped", () => {
    expect(moveMachineGroup(visible, view(), alpha, 1)).toEqual([local, zulu, alpha]);
    expect(moveMachineGroup(visible, view({ machineOrder: [zulu] }), alpha, -1)).toEqual([
      zulu,
      alpha,
      local,
    ]);
  });

  it("does nothing at either edge or for a machine without rows", () => {
    expect(moveMachineGroup(visible, view(), local, -1)).toBeNull();
    expect(moveMachineGroup(visible, view(), zulu, 1)).toBeNull();
    expect(moveMachineGroup(visible, view(), EnvironmentId.make("env-gone"), 1)).toBeNull();
  });
});

describe("withConversationSort", () => {
  const shell = (id: string, environmentId: EnvironmentId, at: string) =>
    ({
      id,
      environmentId,
      createdAt: at,
      updatedAt: at,
      latestUserMessageAt: at,
    }) as unknown as EnvironmentThreadShell;
  const shells = [
    shell("old", alpha, "2026-10-01T00:00:00.000Z"),
    shell("new", zulu, "2026-10-03T00:00:00.000Z"),
    shell("mid", alpha, "2026-10-02T00:00:00.000Z"),
  ];
  const ids = (list: readonly EnvironmentThreadShell[]) => list.map((item) => item.id);

  it("replaces whatever order the upstream shelf sort produced", () => {
    const ordered = withConversationSort(shells, view({ grouping: "none" }));
    expect(ids(ordered)).toEqual(["new", "mid", "old"]);
    expect(ids(withConversationSort(shells.toReversed(), view({ grouping: "none" })))).toEqual(
      ids(ordered),
    );
  });

  it("keeps each machine's conversations together when grouped", () => {
    expect(ids(withConversationSort(shells, view()))).toEqual(["mid", "old", "new"]);
  });
});
