import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ThreadListToolbar } from "./ThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null ||
    props.selectedProjectKey !== null ||
    props.conversationSortOrder !== "updated_at" ||
    props.conversationGrouping !== "none";
  const sortActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "sort:updated_at",
        title: "Recent activity",
        state: checkedMenuState(props.conversationSortOrder === "updated_at"),
      },
      {
        id: "sort:created_at",
        title: "Created",
        state: checkedMenuState(props.conversationSortOrder === "created_at"),
      },
      {
        id: "sort:cache_expiry",
        title: "Cache expiry",
        state: checkedMenuState(props.conversationSortOrder === "cache_expiry"),
      },
    ],
    [props.conversationSortOrder],
  );
  const groupActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "group:none",
        title: "No grouping",
        state: checkedMenuState(props.conversationGrouping === "none"),
      },
      {
        id: "group:machine",
        title: "By machine",
        state: checkedMenuState(props.conversationGrouping === "machine"),
      },
    ],
    [props.conversationGrouping],
  );
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
    ],
    [props.environments, props.projects, props.selectedEnvironmentId, props.selectedProjectKey],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }

      if (id === "sort:updated_at") props.onConversationSortOrderChange("updated_at");
      else if (id === "sort:created_at") props.onConversationSortOrderChange("created_at");
      else if (id === "sort:cache_expiry") props.onConversationSortOrderChange("cache_expiry");
      else if (id === "group:none") props.onConversationGroupingChange("none");
      else if (id === "group:machine") props.onConversationGroupingChange("machine");
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <ThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
        sortActions={sortActions}
        onSortAction={handleMenuAction}
        sortCustomized={props.conversationSortOrder !== "updated_at"}
        groupActions={groupActions}
        onGroupAction={handleMenuAction}
        groupCustomized={props.conversationGrouping !== "none"}
      />
    </>
  );
}
