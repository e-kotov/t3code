import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyConversationListMenuEvent,
  conversationChoiceActions,
  conversationListControls,
  DEFAULT_CONVERSATION_LIST_OPTIONS,
  isConversationListCustomized,
  type ConversationListOptions,
} from "./conversationListOptions";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

const defaults: ConversationListOptions = DEFAULT_CONVERSATION_LIST_OPTIONS;

function controls() {
  return {
    ...defaults,
    onConversationSortOrderChange: vi.fn(),
    onConversationGroupingChange: vi.fn(),
  };
}

describe("conversationListOptions", () => {
  it("reports customization only for non-default sort or grouping", () => {
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
    expect(conversationChoiceActions("sort", defaults, "off")).toEqual([
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
    expect(buildHomeListFilterMenuItems(emptyBase).map((item) => item.title)).toEqual([
      "Environment",
    ]);

    const list = controls();
    const items = buildHomeListFilterMenuItems({
      ...base,
      ...list,
      machineSummary: "1 machine · 3 active",
    });
    expect(items.map((item) => item.title)).toEqual([
      "Environment",
      "Project",
      "Sort conversations",
      "Group conversations",
    ]);
    const envSubmenu = items[0];
    const projSubmenu = items[1];
    expect(envSubmenu && "items" in envSubmenu && envSubmenu.items[1]?.title).toBe("MacBook (3)");
    expect(
      envSubmenu &&
        "items" in envSubmenu &&
        !("items" in envSubmenu.items[1]!) &&
        envSubmenu.items[1]?.subtitle,
    ).toBe("3 active");
    expect(projSubmenu && "items" in projSubmenu && projSubmenu.items[1]?.title).toBe("t3code (2)");
    expect(
      projSubmenu &&
        "items" in projSubmenu &&
        !("items" in projSubmenu.items[1]!) &&
        projSubmenu.items[1]?.subtitle,
    ).toBe("2 active");

    const grouping = items[3];
    expect(
      grouping &&
        "items" in grouping &&
        grouping.items.map((item) => (!("items" in item) ? item.selected : undefined)),
    ).toEqual([false]);
    expect(grouping && "items" in grouping && grouping.items[0]?.title).toBe(
      "By machine · 1 machine · 3 active",
    );
    if (grouping && "items" in grouping && grouping.items[0] && !("items" in grouping.items[0])) {
      grouping.items[0].onPress();
    }
    expect(list.onConversationGroupingChange).toHaveBeenCalledWith("machine");
  });
});
