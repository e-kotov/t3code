import type { EnvironmentId } from "@t3tools/contracts";
import {
  buildConversationListFilterSubmenus,
  type ConversationListControls,
} from "./conversationListOptions";
import { formatFilterOptionTitle, formatFilterOptionSubtitle } from "./mobileNonSettledCounts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import {
  machineFilterOptionPresentation,
  type MachineFilterDetails,
} from "./machineFilterPresentation";
import { msg } from "gt-react-native";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import { m, type MessageResolver } from "../../i18n/messages";
import type { WorkspaceEnvironment } from "../../state/workspaceModel";

export interface HomeListFilterMenuEnvironment extends MachineFilterDetails {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly nonSettledCount?: number;
}

export function homeListFilterEnvironments(environments: ReadonlyArray<WorkspaceEnvironment>) {
  return Arr.sort(
    environments
      .filter((environment) => environment.isEnabled)
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.environmentLabel,
        connectionState: environment.connectionState,
      })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
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
  resolve: MessageResolver = m,
): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [
    {
      id: "environment",
      title: resolve(msg("Environment", { $context: "filter menu heading" })),
      items: [
        {
          id: "environment:all",
          title: resolve(msg("All environments")),
          subtitle: resolve(msg("Show threads from every environment")),
          selected: props.selectedEnvironmentId === null,
          onPress: () => props.onEnvironmentChange(null),
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          ...machineFilterOptionPresentation(environment),
          selected: props.selectedEnvironmentId === environment.environmentId,
          onPress: () => props.onEnvironmentChange(environment.environmentId),
        })),
      ],
    },
  ];

  if (props.projects.length > 0) {
    items.push({
      id: "project",
      title: resolve(msg("Project", { $context: "filter menu heading" })),
      items: [
        {
          id: "project:all",
          title: resolve(msg("All projects")),
          subtitle: resolve(msg("Show threads from every project")),
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
  if (props.onWorkingOnlyChange) {
    items.push({
      id: "working:only",
      title: resolve(msg("Working only")),
      selected: props.workingOnly ?? false,
      onPress: () => props.onWorkingOnlyChange?.(!props.workingOnly),
    });
  }
  items.push(...buildConversationListFilterSubmenus(props, resolve));

  return items;
}
