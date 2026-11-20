import type { ScheduledTask } from "@t3tools/contracts";

export function filterScheduledTasks<T extends Pick<ScheduledTask, "title" | "prompt">>(
  tasks: readonly T[],
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tasks;

  return tasks.filter(
    (task) =>
      task.title.toLowerCase().includes(needle) || task.prompt.toLowerCase().includes(needle),
  );
}
