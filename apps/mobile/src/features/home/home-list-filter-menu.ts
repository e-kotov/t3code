import type { EnvironmentId } from "@t3tools/contracts";
import {
  buildConversationListFilterSubmenus,
  type ConversationListControls,
} from "./conversationListOptions";
import { formatFilterOptionTitle, formatFilterOptionSubtitle } from "./mobileNonSettledCounts";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly nonSettledCount?: number;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
  readonly nonSettledCount?: number;
}

export function buildHomeListFilterMenuItems(
  props: {
    readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
    readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
    readonly selectedEnvironmentId: EnvironmentId | null;
    readonly selectedProjectKey: string | null;
    readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
    readonly onProjectChange: (projectKey: string | null) => void;
    readonly machineSummary?: string;
  } & Partial<ConversationListControls>,
): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [
    {
      id: "environment",
      title: "Environment",
      items: [
        {
          id: "environment:all",
          title: "All environments",
          subtitle: "Show threads from every environment",
          selected: props.selectedEnvironmentId === null,
          onPress: () => props.onEnvironmentChange(null),
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: formatFilterOptionTitle(environment.label, environment.nonSettledCount),
          ...(environment.nonSettledCount !== undefined && environment.nonSettledCount > 0
            ? { subtitle: formatFilterOptionSubtitle(environment.nonSettledCount) }
            : {}),
          selected: props.selectedEnvironmentId === environment.environmentId,
          onPress: () => props.onEnvironmentChange(environment.environmentId),
        })),
      ],
    },
  ];

  if (props.projects.length > 0) {
    items.push({
      id: "project",
      title: "Project",
      items: [
        {
          id: "project:all",
          title: "All projects",
          subtitle: "Show threads from every project",
          selected: props.selectedProjectKey === null,
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          id: `project:${project.key}`,
          title: formatFilterOptionTitle(project.label, project.nonSettledCount),
          ...(project.nonSettledCount !== undefined && project.nonSettledCount > 0
            ? { subtitle: formatFilterOptionSubtitle(project.nonSettledCount) }
            : {}),
          selected: props.selectedProjectKey === project.key,
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }
  items.push(...buildConversationListFilterSubmenus(props));

  return items;
}
