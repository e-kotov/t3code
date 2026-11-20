import type { EnvironmentId, ProjectId, ScheduledTask } from "@t3tools/contracts";
import { foldSearchQuery } from "@t3tools/shared/paletteSearch";
import { Atom } from "effect/reactivity";

import type { EnvironmentProject } from "./state/models.ts";

type SearchProject = Pick<EnvironmentProject, "environmentId" | "id" | "title">;

// Not kept alive, so the search clears once the scheduled tasks page unmounts.
export const scheduledTaskSearchInputAtom = Atom.make({ query: "", includePrompts: false });

/** One search per app, shared by the page's search box, lists and rows. */
export function makeScheduledTaskSearchAtom(projects: Atom.Atom<ReadonlyArray<SearchProject>>) {
  return Atom.make((get) => {
    const { query, includePrompts } = get(scheduledTaskSearchInputAtom);
    return createScheduledTaskSearch(query, includePrompts, get(projects));
  });
}

type SearchTask = Pick<ScheduledTask, "title" | "prompt" | "projectId">;

export function createScheduledTaskSearch(
  query: string,
  includePrompts: boolean,
  projects: ReadonlyArray<SearchProject>,
) {
  const needle = foldSearchQuery(query);
  const matches = (text: string) => foldSearchQuery(text).includes(needle);
  // Project ids repeat across machines, so titles are kept per environment.
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
  const projectTitle = (environmentId: EnvironmentId, projectId: ProjectId) =>
    projectTitles.get(environmentId)?.get(projectId);
  const matchesTask = (task: SearchTask, environmentId: EnvironmentId) => {
    if (!needle) return true;
    const project = projectTitle(environmentId, task.projectId);
    return (
      matches(task.title) ||
      (project !== undefined && matches(project)) ||
      (includePrompts && matches(task.prompt))
    );
  };

  return {
    active: needle.length > 0,
    includePrompts,
    matches: matchesTask,
    projectTitle,
    filter<T extends SearchTask>(tasks: readonly T[], environmentId: EnvironmentId): readonly T[] {
      return needle ? tasks.filter((task) => matchesTask(task, environmentId)) : tasks;
    },
  };
}
