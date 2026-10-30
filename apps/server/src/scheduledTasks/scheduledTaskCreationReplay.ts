import type { ScheduledTask, ScheduledTaskUpsertInput } from "@t3tools/contracts";

export type ScheduledTaskServiceUpsertInput = ScheduledTaskUpsertInput & {
  readonly preserveExistingOnReplay?: boolean;
};

export function scheduledTaskCreationReplay(
  input: ScheduledTaskServiceUpsertInput,
  existing: ScheduledTask | null,
) {
  // A replay must not rewrite work the user rebound above the caller's mode ceiling.
  return input.preserveExistingOnReplay && input.commandId !== undefined && existing !== null
    ? existing
    : null;
}
