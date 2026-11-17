import { describe, expect, it } from "vite-plus/test";
import {
  resolveSelectedNavigationTab,
  selectedNavigationTab,
} from "../layout/workspace/navigation-tab-order";
import { highlightUtilities, keepUtilities, sharedSlotAbsentee } from "./utilitiesWorkspaceTab";
import {
  initialWorkspaceTabsState,
  workspaceTabsReducer,
  workspaceUsesColumns,
} from "../layout/workspace/workspace-tabs-state";
import { workspaceTabNavigationState } from "../layout/workspace/workspace-tab-navigation";

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

it("retains Settings search when Utilities is selected", () => {
  let state = workspaceTabsReducer(initialWorkspaceTabsState(), {
    type: "query",
    tab: "settings",
    query: "tail",
  });
  state = workspaceTabsReducer(state, { type: "select", tab: "commands" });
  expect(state.selectedTab).toBe("commands");
  expect(workspaceUsesColumns("commands")).toBe(false);
  expect(workspaceUsesColumns("commands", true)).toBe(true);
  expect(workspaceUsesColumns("issues")).toBe(true);
  expect(workspaceTabsReducer(state, { type: "search" })).toBe(state);
  expect(state.tabs.settings.query).toBe("tail");
});

it("opens Utilities without restoring a chat or pull-request detail beside it", () => {
  const check = { thread: () => true, pullRequest: () => true, issue: () => true };
  const home = { key: "home", name: "Home" };
  const thread = {
    key: "chat",
    name: "Thread",
    params: { environmentId: "env", threadId: "chat" },
  };
  const next = workspaceTabNavigationState(
    { routes: [home, thread] },
    "commands",
    { threads: thread.params },
    { columns: true, check },
  );
  expect(next.routes).toEqual([home]);
});

it("keeps the saved PR or Issues slot while Utilities is selected", () => {
  expect(sharedSlotAbsentee("commands", "issues")).toBe("pullRequests");
  expect(sharedSlotAbsentee("commands", "pullRequests")).toBe("issues");
  expect(sharedSlotAbsentee("issues", "pullRequests")).toBe("pullRequests");
});

it("restores Issues detail in columns after leaving Utilities", () => {
  const home = { key: "home", name: "Home" };
  const issue = {
    environmentId: "env",
    projectId: "project",
    tracker: "github",
    scope: "owner/repo",
    issueKey: "42",
  };
  const check = { thread: () => true, pullRequest: () => true, issue: () => true };
  const utilities = workspaceTabNavigationState(
    { routes: [home] },
    "commands",
    { issues: issue },
    { columns: true, check },
  );
  expect(utilities.routes).toEqual([home]);
  const next = workspaceTabNavigationState(
    utilities,
    "issues",
    { issues: issue },
    { columns: true, check },
  );
  expect(next.routes).toHaveLength(2);
  expect(next.routes[1]).toMatchObject({ name: "Issue", params: issue });
});
