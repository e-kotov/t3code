export function defaultScheduledTaskBinding(
  requested: boolean | undefined,
  useCurrentThread: boolean,
  hasMatchingThread: boolean,
): boolean {
  return requested ?? (useCurrentThread && hasMatchingThread);
}
