import type { ScheduledTask, ScheduledTaskUpsertInput } from "@t3tools/contracts";

export type ScheduledTaskServiceUpsertInput = ScheduledTaskUpsertInput & {
  readonly preserveExistingOnReplay?: boolean;
};

export function scheduledTaskCreationReplay(
  input: ScheduledTaskServiceUpsertInput,
  existing: ScheduledTask | null,
) {
  // A retried create must not rewrite the task, including the user's later edits to it.
  return input.preserveExistingOnReplay && input.commandId !== undefined && existing !== null
    ? existing
    : null;
}
