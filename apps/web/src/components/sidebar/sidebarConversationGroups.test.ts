import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarDropTarget,
  resolveSidebarRowThreadId,
  planSidebarThreadDrop,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "../Sidebar.logic";
import { makeThreadFixture } from "../../test-fixtures";
import {
  withConversationSort,
  visibleSidebarKeys,
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

  it("folds a machine across shelves while retaining headers and the saved machine order", () => {
    const folded = view({ machineOrder: [alpha, local, zulu], collapsedMachineGroups: [local] });
    for (const section of ["pinned", "active", "working", "snoozed", "settled"] as const) {
      expect(layout(groupSidebarRowsByMachine(threads, section, folded, rowsOf))).toEqual([
        "[env-alpha:0/3]",
        "a1",
        "[env-local:1/3]",
        "[env-zulu:2/3]",
        "z1",
      ]);
    }
    expect(
      layout(
        groupSidebarRowsByMachine(
          threads,
          "active",
          {
            ...folded,
            collapsedMachineGroups: [],
          },
          rowsOf,
        ),
      ),
    ).toEqual(["[env-alpha:0/3]", "a1", "[env-local:1/3]", "l1", "l2", "[env-zulu:2/3]", "z1"]);
  });

  it("keeps the expand control reachable when a folded machine is the only remaining machine", () => {
    expect(
      layout(
        groupSidebarRowsByMachine(
          [thread("a1", alpha)],
          "active",
          view({
            collapsedMachineGroups: [alpha],
          }),
          rowsOf,
        ),
      ),
    ).toEqual(["[env-alpha:0/1]"]);
  });

  it("keeps the open conversation visible in a folded machine without exposing its other rows", () => {
    const selected = {
      ...view({ collapsedMachineGroups: [local] }),
      selectedThreadKey: "env-local:l2",
    };
    expect(layout(groupSidebarRowsByMachine(threads, "active", selected, rowsOf))).toEqual([
      "[env-local:0/3]",
      "l2",
      "[env-alpha:1/3]",
      "a1",
      "[env-zulu:2/3]",
      "z1",
    ]);
  });

  it("retains an open subagent's resolved ancestor row when its machine is folded", () => {
    const root = makeThreadFixture({ id: ThreadId.make("root"), environmentId: alpha });
    const child = makeThreadFixture({
      id: ThreadId.make("child"),
      environmentId: alpha,
      lineage: { rootThreadId: root.id, parentThreadId: root.id, relationshipToParent: "subagent" },
    });
    const hidden = makeThreadFixture({ id: ThreadId.make("hidden"), environmentId: alpha });
    const rowId = resolveSidebarRowThreadId(child.id, alpha, [root, child, hidden]);
    const selected = {
      ...view({ collapsedMachineGroups: [alpha] }),
      selectedThreadKey: `${alpha}:${rowId}`,
    };
    expect(layout(groupSidebarRowsByMachine([root, hidden], "active", selected, rowsOf))).toEqual([
      "[env-alpha:0/1]",
      "root",
    ]);
    expect(
      visibleSidebarKeys(
        [root, hidden],
        new Map([
          [`${alpha}:root`, "active"],
          [`${alpha}:hidden`, "active"],
        ]),
        selected,
      ),
    ).toEqual([`${alpha}:root`]);
  });

  it("ignores folded machines when grouping is turned off", () => {
    expect(
      layout(
        groupSidebarRowsByMachine(
          threads,
          "active",
          view({
            grouping: "none",
            collapsedMachineGroups: [local, alpha, zulu],
          }),
          rowsOf,
        ),
      ),
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

  it("keeps the single-machine header available before and after expanding", () => {
    expect(
      layout(
        groupSidebarRowsByMachine(
          [thread("a1", alpha), thread("a2", alpha)],
          "pinned",
          view(),
          rowsOf,
        ),
      ),
    ).toEqual(["[env-alpha:0/1]", "a1", "a2"]);
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
  it("reorders visible rows without overwriting a folded machine's reserved pin key", () => {
    const folded = view({ collapsedMachineGroups: [alpha] });
    const pinned = [thread("p1", local), thread("hidden", alpha), thread("p2", local)];
    const items: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      ...groupSidebarRowsByMachine(pinned, "pinned", folded, rowsOf),
      { kind: "marker", marker: "pinned-divider" },
    ];
    const target = resolveSidebarDropTarget(items, "p1", "p2")!;
    const keys = new Map([
      ["p1", "f"],
      ["hidden", "z"],
      ["p2", "t"],
    ]);
    const plan = planSidebarThreadDrop({
      activeKey: "p1",
      activeSection: "pinned",
      target,
      pinnedOrder: ["p1", "hidden", "p2"],
      pinnedKeysById: keys,
      activeOrder: [],
      activeKeysById: new Map(),
    });
    expect(plan.kind).toBe("reorder-pinned");
    if (plan.kind !== "reorder-pinned") throw new Error("Expected a pinned reorder");
    expect(plan.order).toEqual(["p2", "p1"]);
    expect(plan.assignments.every(({ id, orderKey }) => id !== "hidden" && orderKey !== "z")).toBe(
      true,
    );
    expect(keys.get("hidden")).toBe("z");
  });

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

describe("visibleSidebarKeys", () => {
  it("uses rendered shelf and machine order for keyboard jumps, ranges and traversal", () => {
    const shelves = [
      [thread("pin-a", alpha), thread("pin-l", local)],
      [thread("a1", alpha), thread("l1", local), thread("a2", alpha), thread("z1", zulu)],
      [thread("settled-l", local), thread("settled-z", zulu)],
    ];
    const folded = view({ machineOrder: [zulu, local, alpha], collapsedMachineGroups: [alpha] });
    const sections = ["pinned", "active", "settled"] as const;
    const sectionByKey = new Map(
      shelves.flatMap((shelf, index) =>
        shelf.map((thread) => [`${thread.environmentId}:${thread.id}`, sections[index]!] as const),
      ),
    );
    const visible = visibleSidebarKeys(shelves.flat(), sectionByKey, folded);
    const rendered = shelves.flatMap((shelf) =>
      groupSidebarRowsByMachine(shelf, "active", folded, rowsOf).flatMap((item) =>
        item.kind === "thread" ? [item.key] : [],
      ),
    );
    expect(visible).toEqual([
      "env-local:pin-l",
      "env-zulu:z1",
      "env-local:l1",
      "env-zulu:settled-z",
      "env-local:settled-l",
    ]);
    expect(visible.map((key) => key.split(":")[1])).toEqual(rendered);
    expect(
      visibleSidebarKeys(shelves.flat(), sectionByKey, { ...folded, grouping: "none" }),
    ).toEqual(shelves.flat().map((thread) => `${thread.environmentId}:${thread.id}`));
  });
});
