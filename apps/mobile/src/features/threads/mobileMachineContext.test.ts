import { describe, expect, it } from "vite-plus/test";

import { groupThreadListV2ItemsByMachine } from "./machineGroupedThreadList";
import { withMobileMachineContext } from "./mobileMachineContext";
import type { ThreadListV2ListItem } from "./threadListV2";

const environments = [
  { environmentId: "gwdg", label: "GWDG" },
  { environmentId: "mac", label: "Mac Studio" },
];
const machineKinds = new Map([
  ["gwdg", "server"],
  ["mac", "mac-studio"],
] as const);
const labels = new Map(environments.map(({ environmentId, label }) => [environmentId, label]));

const row = (environmentId: string, key: string) =>
  ({ type: "v2-thread", key, item: { thread: { environmentId } } }) as unknown as ThreadListV2ListItem;

describe("mobile machine context", () => {
  it.each(["none", "machine"] as const)(
    "keeps the single visible machine identifiable with %s grouping",
    (grouping) => {
      const rows = [row("gwdg", "first"), row("gwdg", "second")];
      const items = grouping === "machine" ? groupThreadListV2ItemsByMachine(rows, labels) : rows;
      const displayed = withMobileMachineContext(items, environments, machineKinds, []);

      expect(displayed[0]).toMatchObject({
        type: "v2-machine-header",
        environmentId: "gwdg",
        label: "GWDG",
        machineKind: "server",
        position: 0,
        count: 1,
      });
      expect(displayed.slice(1)).toEqual(rows);
      expect(displayed.filter((item) => item.type === "v2-machine-header")).toHaveLength(1);
    },
  );

  it("shows each ungrouped machine once without changing conversation order", () => {
    const rows = [row("gwdg", "g1"), row("mac", "m1"), row("gwdg", "g2")];
    const displayed = withMobileMachineContext(rows, environments, machineKinds, ["mac", "gwdg"]);
    expect(displayed.slice(0, 2)).toMatchObject([
      { type: "v2-machine-header", label: "Mac Studio", machineKind: "mac-studio", position: 0 },
      { type: "v2-machine-header", label: "GWDG", machineKind: "server", position: 1 },
    ]);
    expect(displayed.slice(2)).toEqual(rows);
  });

  it("preserves existing grouped headers and their list identity", () => {
    const grouped = groupThreadListV2ItemsByMachine(
      [row("gwdg", "g1"), row("mac", "m1")],
      labels,
      [],
      machineKinds,
    );
    expect(withMobileMachineContext(grouped, environments, machineKinds, [])).toBe(grouped);
  });

  it("includes a machine with only a queued offline task", () => {
    const pending = {
      type: "v2-pending",
      key: "queued",
      pendingTask: { environmentId: "gwdg" },
    } as unknown as ThreadListV2ListItem;
    const displayed = withMobileMachineContext([pending], environments, machineKinds, []);
    expect(displayed[0]).toMatchObject({ type: "v2-machine-header", label: "GWDG" });
    expect(displayed[1]).toBe(pending);
  });

  it("keeps empty and shelf-only lists empty of machine summaries", () => {
    const empty: ThreadListV2ListItem[] = [];
    const shelf: ThreadListV2ListItem[] = [
      { type: "v2-settled-shelf", key: "v2-settled-shelf", count: 2, expanded: false, disabled: false },
    ];
    expect(withMobileMachineContext(empty, environments, machineKinds, [])).toBe(empty);
    expect(withMobileMachineContext(shelf, environments, machineKinds, [])).toBe(shelf);
  });

  it("uses a stable fallback until a saved machine's details are available", () => {
    expect(withMobileMachineContext([row("unavailable", "u1")], [], new Map(), [])[0]).toMatchObject({
      label: "Machine",
      machineKind: "server",
      environmentId: "unavailable",
    });
  });
});
