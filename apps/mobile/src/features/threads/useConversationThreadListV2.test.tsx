import { act } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import { useMachineGroupCollapse } from "./machineGroupCollapse";
import { useConversationThreadListV2 } from "./useConversationThreadListV2";

// These fixtures are already loaded; paging uses the native runtime outside this test.
vi.mock("../../state/olderSettledShelf", () => ({
  useOlderSettledShelf: () => ({
    isListed: () => true,
    unloadedCount: () => 0,
  }),
  useOlderSettledShelfGrowth: () => {},
}));

it("updates sort and machine grouping while retaining upstream pinned ordering and search", () => {
  const a = EnvironmentId.make("a");
  const b = EnvironmentId.make("b");
  const threads = [
    makeThreadShellFixture({
      environmentId: a,
      id: ThreadId.make("old"),
      title: "Old",
      activeOrderKey: "a",
      createdAt: "2026-01-01T00:00:00Z",
    }),
    makeThreadShellFixture({
      environmentId: b,
      id: ThreadId.make("new"),
      title: "New",
      activeOrderKey: "b",
      createdAt: "2026-10-01T00:00:00Z",
    }),
    makeThreadShellFixture({
      environmentId: a,
      id: ThreadId.make("pin"),
      title: "Pinned",
      pinnedAt: "2026-10-01T00:00:00Z",
      pinOrderKey: "a",
    }),
  ];
  function List({
    sort,
    grouped,
    search = "",
    selected = null,
  }: {
    sort: "created_at" | undefined;
    grouped: boolean;
    search?: string;
    selected?: string | null;
  }) {
    const { toggleMachineGroup } = useMachineGroupCollapse();
    const { items } = useConversationThreadListV2({
      threads,
      pendingTasks: [],
      environmentId: null,
      projectRefs: null,
      searchQuery: search,
      searchMatches: new Map(),
      settlementEnvironmentIds: new Set(),
      snoozeEnvironmentIds: new Set(),
      pinReorderEnvironmentIds: new Set(),
      activeReorderEnvironmentIds: new Set(),
      queuedThreadKeys: new Set(),
      settledLimit: 20,
      now: "2026-10-25T12:00:00Z",
      pendingOrder: null,
      shelfPreferencesLoaded: true,
      workingShelfEnabled: false,
      workingShelfExpanded: true,
      snoozedShelfExpanded: true,
      settledShelfExpanded: true,
      selectedThreadKey: selected,
      conversation: {
        view: { conversationSortOrder: sort, conversationGrouping: grouped ? "machine" : "none" },
        environments: [
          { environmentId: a, label: "Alpha" },
          { environmentId: b, label: "Beta" },
        ],
        machineKinds: new Map(),
        machineOrder: [b, a],
      },
    });
    return (
      <ol>
        <button onClick={() => toggleMachineGroup(a)}>Toggle Alpha</button>
        {items.map((item) => (
          <li key={item.key}>
            {item.type === "v2-thread"
              ? item.item.thread.title
              : item.type === "v2-machine-header"
                ? item.label
                : item.type}
          </li>
        ))}
      </ol>
    );
  }
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  using _screen = {
    [Symbol.dispose]() {
      act(() => root.unmount());
      globals.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
  const titles = () =>
    [...host.querySelectorAll("li")]
      .map((row) => row.textContent)
      .filter((title) => ["Old", "New", "Pinned"].includes(title ?? ""));
  act(() => root.render(<List sort={undefined} grouped={false} />));
  expect(titles()).toEqual(["Pinned", "Old", "New"]);
  act(() => root.render(<List sort="created_at" grouped={false} />));
  expect(titles()).toEqual(["Pinned", "New", "Old"]);
  act(() => root.render(<List sort="created_at" grouped />));
  expect(titles()).toEqual(["Pinned", "New", "Old"]);
  expect([...host.querySelectorAll("li")].map((row) => row.textContent)).toContain("Beta");
  act(() => host.querySelector("button")!.click());
  expect(titles()).toEqual(["New"]);
  expect([...host.querySelectorAll("li")].map((row) => row.textContent)).toContain("Alpha");
  act(() => root.render(<List sort="created_at" grouped search="Old" />));
  expect(titles()).toEqual(["Old"]);
  act(() => root.render(<List sort="created_at" grouped search="   " />));
  expect(titles()).toEqual(["New"]);
  act(() => root.render(<List sort="created_at" grouped selected="a:old" />));
  expect(titles()).toEqual(["New", "Old"]);
  act(() => root.render(<List sort="created_at" grouped={false} />));
  expect(titles()).toEqual(["Pinned", "New", "Old"]);
  act(() => root.render(<List sort="created_at" grouped />));
  expect(titles()).toEqual(["New"]);
  act(() => host.querySelector("button")!.click());
  expect(titles()).toEqual(["Pinned", "New", "Old"]);
});
