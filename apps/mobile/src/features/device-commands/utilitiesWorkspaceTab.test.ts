import { describe, expect, it } from "vite-plus/test";
import {
  resolveSelectedNavigationTab,
  selectedNavigationTab,
} from "../workspace/navigation-tab-order";
import { highlightUtilities, keepUtilities } from "./utilitiesWorkspaceTab";

describe("Utilities workspace tab", () => {
  it("stays selected although upstream does not register it as a section", () => {
    const resolve = keepUtilities(resolveSelectedNavigationTab);
    expect(resolve(undefined, [], "commands")).toBe("commands");
    expect(resolve(undefined, ["threads"], "commands")).toBe("commands");
    expect(resolve(undefined, ["threads"], "threads")).toBe("pullRequests");
  });

  it("is highlighted in navigation unless Settings is open", () => {
    const select = highlightUtilities(selectedNavigationTab);
    expect(select(undefined, "commands", false, [], 4)).toBe("commands");
    expect(select(undefined, "commands", true, [], 4)).toBe("settings");
    expect(select(undefined, "usage", false, [], 4)).toBe("usage");
    expect(select(undefined, "threads", true)).toBe("settings");
  });
});

it("retains Settings search when Utilities is selected", async () => {
  const { initialWorkspaceTabsState, workspaceTabsReducer } =
    await import("../workspace/workspace-tabs-state");
  let state = workspaceTabsReducer(initialWorkspaceTabsState(), {
    type: "query",
    tab: "settings",
    query: "tail",
  });
  state = workspaceTabsReducer(state, { type: "select", tab: "commands" });
  expect(state.selectedTab).toBe("commands");
  expect(workspaceTabsReducer(state, { type: "search" })).toBe(state);
  expect(state.tabs.settings.query).toBe("tail");
});
