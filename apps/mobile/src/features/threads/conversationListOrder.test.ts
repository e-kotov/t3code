import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { compareMachineOrder, moveMachineInOrder } from "./conversationListOrder";
import {
  arrangeMobileConversationList,
  groupThreadListV2ItemsByMachine,
} from "./machineGroupedThreadList";
import {
  buildThreadListV2Items,
  threadListV2ListItemsAreEqual,
  type ThreadListV2ListItem,
} from "./threadListV2";

const NOW = "2026-06-02T12:00:00.000Z";
const environmentId = EnvironmentId.make("environment-1");

function makeThread(
  input: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id" | "title">,
): EnvironmentThreadShell {
  return makeThreadShellFixture({ environmentId, ...input });
}

function hotCache(updatedAt: string, ttlMs: number): EnvironmentThreadShell["cacheHud"] {
  return {
    driver: "claudeAgent",
    basis: "reported",
    ttlMs,
    usage: { usedTokens: 10, cachedInputTokens: 10, updatedAt },
  } as unknown as EnvironmentThreadShell["cacheHud"];
}

const row = (machine: string, key: string) =>
  ({
    type: "v2-thread",
    key,
    item: { thread: { environmentId: machine } },
  }) as unknown as ThreadListV2ListItem;

const keyOf = (item: { readonly type: string; readonly key: string }) =>
  "environmentId" in item && item.type === "v2-machine-header"
    ? `[${String(item.environmentId)}]`
    : item.key;

describe("conversation sort in buildThreadListV2Items", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const threads = [
    makeThread({
      id: ThreadId.make("pinned-later"),
      title: "Pinned later",
      pinnedAt: NOW,
      pinOrderKey: "t",
      createdAt: "2026-06-02T00:00:00.000Z",
      cacheHud: hotCache("2026-06-02T11:59:00.000Z", 60_000 * 10),
    }),
    makeThread({
      id: ThreadId.make("pinned-first"),
      title: "Pinned first",
      pinnedAt: NOW,
      pinOrderKey: "f",
      createdAt: "2026-05-01T00:00:00.000Z",
    }),
    // Saved order f, m, t; created_at m, f, t; recent activity t, f, m.
    makeThread({
      id: ThreadId.make("active-f"),
      title: "Active f",
      activeOrderKey: "f",
      createdAt: "2026-05-01T00:00:00.000Z",
      latestUserMessageAt: "2026-06-02T10:00:00.000Z",
    }),
    makeThread({
      id: ThreadId.make("active-m"),
      title: "Active m",
      activeOrderKey: "m",
      createdAt: "2026-06-01T00:00:00.000Z",
      latestUserMessageAt: "2026-06-02T09:00:00.000Z",
      cacheHud: hotCache("2026-06-02T11:58:00.000Z", 60_000 * 5),
    }),
    makeThread({
      id: ThreadId.make("active-t"),
      title: "Active t",
      activeOrderKey: "t",
      createdAt: "2026-04-01T00:00:00.000Z",
      latestUserMessageAt: "2026-06-02T11:00:00.000Z",
    }),
    makeThread({
      id: ThreadId.make("snoozed-late"),
      title: "Snoozed late",
      createdAt: "2026-06-02T00:00:00.000Z",
      snoozedUntil: "2026-06-04T09:00:00.000Z",
      snoozedAt: NOW,
    }),
    makeThread({
      id: ThreadId.make("snoozed-soon"),
      title: "Snoozed soon",
      createdAt: "2026-05-01T00:00:00.000Z",
      snoozedUntil: "2026-06-03T09:00:00.000Z",
      snoozedAt: NOW,
    }),
  ];
  const ids = (input: Partial<Parameters<typeof buildThreadListV2Items>[0]> = {}) =>
    buildThreadListV2Items({
      threads,
      environmentId: null,
      searchQuery: "",
      now: NOW,
      snoozedShelfExpanded: true,
      ...input,
    }).items.map((item) => String(item.thread.id));

  const pinned = ["pinned-first", "pinned-later"];
  const snoozed = ["snoozed-soon", "snoozed-late"];

  it("keeps the saved active order when no conversation sort is selected", () => {
    expect(ids()).toEqual([...pinned, "active-f", "active-m", "active-t", ...snoozed]);
  });

  it("re-sorts only the active shelf and keeps pinned and snoozed order", () => {
    expect(ids({ conversationSortOrder: "created_at" })).toEqual([
      ...pinned,
      "active-m",
      "active-f",
      "active-t",
      ...snoozed,
    ]);
    expect(ids({ conversationSortOrder: "updated_at" })).toEqual([
      ...pinned,
      "active-t",
      "active-f",
      "active-m",
      ...snoozed,
    ]);
  });

  it("leads the active shelf with a hot cache until it expires", () => {
    // The pinned row's hotter cache does not lift it out of pin order.
    expect(ids({ conversationSortOrder: "cache_expiry" })).toEqual([
      ...pinned,
      "active-m",
      "active-t",
      "active-f",
      ...snoozed,
    ]);
    vi.setSystemTime(new Date("2026-06-02T12:04:00.000Z"));
    expect(ids({ conversationSortOrder: "cache_expiry" })).toEqual([
      ...pinned,
      "active-t",
      "active-f",
      "active-m",
      ...snoozed,
    ]);
  });

  it("applies the selected sort to expanded Working rows", () => {
    const running = {
      status: "running" as const,
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: NOW,
    };
    const working = [
      makeThread({
        id: ThreadId.make("working-old"),
        title: "Working old",
        runtime: running,
        createdAt: "2026-05-01T00:00:00.000Z",
        latestUserMessageAt: "2026-06-02T11:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("working-new"),
        title: "Working new",
        runtime: running,
        createdAt: "2026-06-01T00:00:00.000Z",
        latestUserMessageAt: "2026-06-02T10:00:00.000Z",
      }),
    ];
    const build = (input: Partial<Parameters<typeof buildThreadListV2Items>[0]>) =>
      buildThreadListV2Items({
        threads: working,
        environmentId: null,
        searchQuery: "",
        now: NOW,
        workingShelfEnabled: true,
        workingShelfExpanded: true,
        ...input,
      }).items.map((item) => String(item.thread.id));
    expect(build({ conversationSortOrder: "created_at" })).toEqual(["working-new", "working-old"]);
    expect(build({ conversationSortOrder: "updated_at" })).toEqual(["working-old", "working-new"]);
  });
});

describe("machine group order", () => {
  it("puts saved machines first in saved order and the rest alphabetically", () => {
    expect(["zeta", "mac", "alpha", "gwdg"].sort(compareMachineOrder(["mac", "gwdg"]))).toEqual([
      "mac",
      "gwdg",
      "alpha",
      "zeta",
    ]);
  });

  it("moves a machine group and stops at either edge", () => {
    const machines = ["gwdg", "mac", "alpha", "mac"];
    expect(moveMachineInOrder(machines, ["mac", "gwdg"], "gwdg", -1)).toEqual([
      "gwdg",
      "mac",
      "alpha",
    ]);
    expect(moveMachineInOrder(machines, [], "alpha", 1)).toEqual(["gwdg", "alpha", "mac"]);
    expect(moveMachineInOrder(machines, ["mac", "gwdg"], "mac", -1)).toBeNull();
    expect(moveMachineInOrder(machines, ["mac", "gwdg"], "alpha", 1)).toBeNull();
    expect(moveMachineInOrder(machines, [], "unknown", 1)).toBeNull();
  });
});

describe("groupThreadListV2ItemsByMachine", () => {
  const labels = new Map([
    ["machine-a", "A"],
    ["machine-b", "B"],
  ]);

  it("uses the persisted order and exposes move positions on machine headers", () => {
    const grouped = groupThreadListV2ItemsByMachine(
      [row("machine-b", "b1"), row("machine-a", "a1"), row("machine-b", "b2")],
      labels,
      ["machine-b", "machine-a"],
    );
    expect(grouped.map(keyOf)).toEqual(["[machine-b]", "b1", "b2", "[machine-a]", "a1"]);
    expect(
      grouped.flatMap((item) =>
        item.type === "v2-machine-header" ? [[item.position, item.count, item.label]] : [],
      ),
    ).toEqual([
      [0, 2, "B"],
      [1, 2, "A"],
    ]);
  });

  it("groups each run of rows separately and leaves shelves and trailing rows in place", () => {
    const shelf = {
      type: "v2-settled-shelf",
      key: "v2-settled-shelf",
      count: 2,
      expanded: true,
      disabled: false,
    } as const;
    const showMore = { type: "v2-show-more", key: "v2-show-more", hiddenCount: 3 } as const;
    const grouped = groupThreadListV2ItemsByMachine(
      [
        row("machine-a", "a1"),
        row("machine-b", "b1"),
        row("machine-a", "a2"),
        shelf,
        row("machine-b", "b3"),
        row("machine-a", "a3"),
        showMore,
      ],
      labels,
    );
    expect(grouped.map(keyOf)).toEqual([
      "[machine-a]",
      "a1",
      "a2",
      "[machine-b]",
      "b1",
      "v2-settled-shelf",
      "[machine-a]",
      "a3",
      "[machine-b]",
      "b3",
      "v2-show-more",
    ]);
    expect(new Set(grouped.map((item) => item.key)).size).toBe(grouped.length);
  });

  it("keeps a single-machine list unsectioned", () => {
    const rows = [row("machine-a", "a1"), row("machine-a", "a2")];
    const grouped = groupThreadListV2ItemsByMachine(rows, labels);
    expect(grouped).toEqual(rows);
    expect(grouped).not.toBe(rows);
  });
});

describe("arrangeMobileConversationList", () => {
  const environments = [
    { environmentId: "machine-a", label: "A" },
    { environmentId: "machine-b", label: "B" },
  ];
  const machineKinds = new Map([
    ["machine-a", "server"],
    ["machine-b", "mac-studio"],
  ] as const);
  const rows = [row("machine-a", "a1"), row("machine-b", "b1"), row("machine-a", "a2")];

  it("summarizes each machine above an ungrouped list without reordering it", () => {
    const arranged = arrangeMobileConversationList(rows, {
      grouping: "none",
      environments,
      machineKinds,
      machineOrder: ["machine-b"],
    });
    expect(arranged.map(keyOf)).toEqual(["[machine-b]", "[machine-a]", "a1", "b1", "a2"]);
  });

  it("shows one machine header for a single-machine grouped list", () => {
    const single = [row("machine-a", "a1"), row("machine-a", "a2")];
    const arranged = arrangeMobileConversationList(single, {
      grouping: "machine",
      environments,
      machineKinds,
      machineOrder: [],
    });
    expect(arranged.map(keyOf)).toEqual(["[machine-a]", "a1", "a2"]);
    expect(arranged[0]).toMatchObject({ label: "A", machineKind: "server", position: 0, count: 1 });
  });

  it("folds only the selected machine and restores its rows in their original order", () => {
    const options = { grouping: "machine", environments, machineKinds, machineOrder: ["machine-b"] } as const;
    const folded = arrangeMobileConversationList(rows, {
      ...options, collapsedMachineGroups: ["machine-a"],
    });
    expect(folded.map(keyOf)).toEqual(["[machine-b]", "b1", "[machine-a]"]);
    expect(folded.at(-1)).toMatchObject({ collapsible: true, position: 1, count: 2 });
    expect(arrangeMobileConversationList(rows, options).map(keyOf)).toEqual([
      "[machine-b]", "b1", "[machine-a]", "a1", "a2",
    ]);
  });

  it("keeps a single folded machine reachable and preserves shelf and pending rows", () => {
    const shelf = { type: "v2-active-shelf", key: "active" } as const;
    const pending = { type: "v2-pending", key: "pending", pendingTask: { environmentId: "machine-a" } } as const;
    const input = [row("machine-a", "pin"), shelf, pending, row("machine-a", "a1")];
    const folded = arrangeMobileConversationList(input, {
      grouping: "machine", environments, machineKinds, machineOrder: [],
      collapsedMachineGroups: ["machine-a"],
    });
    expect(folded.map(keyOf)).toEqual(["[machine-a]", "active", "pending"]);
    expect(folded[0]).toMatchObject({ collapsible: true });
  });

  it("shows ungrouped conversations even if their machine was folded", () => {
    const arranged = arrangeMobileConversationList(rows, {
      grouping: "none", environments, machineKinds, machineOrder: [],
      collapsedMachineGroups: ["machine-a", "machine-b"],
    });
    expect(arranged.map(keyOf)).toEqual(["[machine-a]", "[machine-b]", "a1", "b1", "a2"]);
    expect(arranged[0]).toMatchObject({ collapsible: false });
  });

  it("sections a multi-machine list once, with a trailing row kept last", () => {
    const showMore = { type: "v2-show-more", key: "v2-show-more", hiddenCount: 1 } as const;
    const input = [...rows, showMore];
    const arranged = arrangeMobileConversationList(input, {
      grouping: "machine",
      environments,
      machineKinds,
      machineOrder: [],
    });
    expect(arranged.map(keyOf)).toEqual([
      "[machine-a]",
      "a1",
      "a2",
      "[machine-b]",
      "b1",
      "v2-show-more",
    ]);
    expect(arranged).not.toBe(input);
  });
});

describe("machine header list equality", () => {
  const header = {
    type: "v2-machine-header",
    key: "v2-machine:0:machine-a",
    label: "A",
    environmentId: "machine-a",
    position: 0,
    count: 2,
    machineKind: "server",
  } as const;

  it("treats a rebuilt identical header as unchanged and a moved one as changed", () => {
    expect(threadListV2ListItemsAreEqual({ ...header }, header)).toBe(true);
    expect(threadListV2ListItemsAreEqual({ ...header, position: 1 }, header)).toBe(false);
    expect(threadListV2ListItemsAreEqual({ ...header, label: "Renamed" }, header)).toBe(false);
    expect(threadListV2ListItemsAreEqual(row("machine-a", header.key), header)).toBe(false);
  });
});
