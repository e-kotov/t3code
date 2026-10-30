export function scheduledTaskHandoffSettings(output: Record<string, unknown>) {
  const boundThreadId = output.boundThreadId;
  return boundThreadId === null || typeof boundThreadId === "string"
    ? { bindToCurrentThread: boundThreadId !== null }
    : {};
}
