import type { EnvironmentId, ProjectId, ScheduledTask } from "@t3tools/contracts";

import type { EnvironmentProject } from "./state/models.ts";

export function createScheduledTaskSearch(
  query: string,
  includePrompts: boolean,
  projects: ReadonlyArray<Pick<EnvironmentProject, "environmentId" | "id" | "title">>,
) {
  const needle = query.trim().toLowerCase();
  const projectTitles = new Map<EnvironmentId, Map<ProjectId, string>>();
  if (needle) {
    for (const project of projects) {
      let titles = projectTitles.get(project.environmentId);
      if (!titles) {
        titles = new Map();
        projectTitles.set(project.environmentId, titles);
      }
      titles.set(project.id, project.title);
    }
  }

  return {
    active: needle.length > 0,
    projectTitle: (environmentId: EnvironmentId, projectId: ProjectId) =>
      projectTitles.get(environmentId)?.get(projectId),
    filter<T extends Pick<ScheduledTask, "title" | "prompt" | "projectId">>(
      tasks: readonly T[],
      environmentId: EnvironmentId,
    ): readonly T[] {
      if (!needle) return tasks;
      const titles = projectTitles.get(environmentId);
      return tasks.filter(
        (task) =>
          task.title.toLowerCase().includes(needle) ||
          titles?.get(task.projectId)?.toLowerCase().includes(needle) ||
          (includePrompts && task.prompt.toLowerCase().includes(needle)),
      );
    },
  };
}

export type ScheduledTaskSearch = ReturnType<typeof createScheduledTaskSearch>;
