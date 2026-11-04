import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import {
  applyConversationListMenuEvent,
  conversationChoiceActions,
  conversationListControls,
  conversationListMenuActions,
  isConversationListCustomized,
  type ConversationListOptions,
} from "./conversationListOptions";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";

const defaults: ConversationListOptions = {
  conversationSortOrder: "updated_at",
  conversationGrouping: "none",
};

function controls() {
  return {
    ...defaults,
    onConversationSortOrderChange: vi.fn(),
    onConversationGroupingChange: vi.fn(),
  };
}

describe("conversation list options", () => {
  it("counts only a non-default sort or grouping as customized", () => {
    const sorted = { ...defaults, conversationSortOrder: "cache_expiry" as const };
    const grouped = { ...defaults, conversationGrouping: "machine" as const };
    expect(isConversationListCustomized(defaults)).toBe(false);
    expect(isConversationListCustomized(sorted)).toBe(true);
    expect(isConversationListCustomized(grouped)).toBe(true);
  });

  it("updates only its own option through the shared options updater", () => {
    let state = { ...defaults, selectedProjectKey: "project" as string | null };
    const list = conversationListControls(state, (patch) => {
      state = { ...state, ...patch };
    });
    list.onConversationSortOrderChange("created_at");
    list.onConversationGroupingChange("machine");
    expect(state).toEqual({
      conversationSortOrder: "created_at",
      conversationGrouping: "machine",
      selectedProjectKey: "project",
    });
  });

  it("applies sort and grouping menu events and ignores unknown values", () => {
    const list = controls();
    expect(applyConversationListMenuEvent("sort:cache_expiry", list)).toBe(true);
    expect(applyConversationListMenuEvent("grouping:machine", list)).toBe(true);
    expect(applyConversationListMenuEvent("sort:bogus", list)).toBe(true);
    expect(applyConversationListMenuEvent("environment:all", list)).toBe(false);
    expect(list.onConversationSortOrderChange.mock.calls).toEqual([["cache_expiry"]]);
    expect(list.onConversationGroupingChange.mock.calls).toEqual([["machine"]]);
  });

  it("marks unchecked header choices off only where the menu asks for it", () => {
    const options = { ...defaults, conversationGrouping: "machine" as const };
    expect(conversationChoiceActions("grouping", options, undefined)).toEqual([
      { id: "grouping:machine", title: "By machine", state: "on" },
    ]);
    expect(
      conversationChoiceActions("grouping", options, undefined, "2 machines · 5 active"),
    ).toEqual([
      { id: "grouping:machine", title: "By machine · 2 machines · 5 active", state: "on" },
    ]);
    expect(conversationListMenuActions(options)[0]?.subactions).toEqual([
      { id: "sort:updated_at", title: "Recent activity · Newest first", state: "on" },
      { id: "sort:created_at", title: "Created · Newest first", state: "off" },
      { id: "sort:cache_expiry", title: "Cache expiry · Soonest first", state: "off" },
    ]);
  });

  it("adds filter submenus and displays non-settled counts", () => {
    const base = {
      environments: [
        { environmentId: EnvironmentId.make("env-1"), label: "MacBook", nonSettledCount: 3 },
      ],
      projects: [{ key: "proj-1", label: "t3code", nonSettledCount: 2 }],
      selectedEnvironmentId: null,
      selectedProjectKey: null,
      onEnvironmentChange: () => {},
      onProjectChange: () => {},
    };
    const emptyBase = {
      ...base,
      environments: [],
      projects: [],
    };
    expect(buildHomeListFilterMenu(emptyBase).items.map((item) => item.title)).toEqual([
      "Environment",
    ]);

    const list = controls();
    const menu = buildHomeListFilterMenu({
      ...base,
      ...list,
      machineSummary: "1 machine · 3 active",
    });
    expect(menu.items.map((item) => item.title)).toEqual([
      "Environment",
      "Project",
      "Sort conversations",
      "Group conversations",
    ]);
    const envSubmenu = menu.items[0];
    const projSubmenu = menu.items[1];
    expect(envSubmenu?.type === "submenu" && envSubmenu.items[1]?.title).toBe("MacBook (3)");
    expect(envSubmenu?.type === "submenu" && envSubmenu.items[1]?.subtitle).toBe("3 active");
    expect(projSubmenu?.type === "submenu" && projSubmenu.items[1]?.title).toBe("t3code (2)");
    expect(projSubmenu?.type === "submenu" && projSubmenu.items[1]?.subtitle).toBe("2 active");

    const grouping = menu.items[3];
    expect(grouping?.type === "submenu" && grouping.items.map((item) => item.state)).toEqual([
      "off",
    ]);
    expect(grouping?.type === "submenu" && grouping.items[0]?.title).toBe(
      "By machine · 1 machine · 3 active",
    );
    if (grouping?.type === "submenu") grouping.items[0]?.onPress();
    expect(list.onConversationGroupingChange).toHaveBeenCalledWith("machine");
  });
});
