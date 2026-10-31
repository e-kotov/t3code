import type { ScheduledTask, ScheduledTaskUpsertInput } from "@t3tools/contracts";

export type ScheduledTaskServiceUpsertInput = ScheduledTaskUpsertInput & {
  readonly keepExistingOnReplay?: boolean;
};

// A retried create returns what it created: its destination came from settings that may have changed since.
export function scheduledTaskCreationReplay(
  input: ScheduledTaskServiceUpsertInput,
  existing: ScheduledTask | null,
): ScheduledTask | null {
  return input.keepExistingOnReplay && input.commandId !== undefined ? existing : null;
}
