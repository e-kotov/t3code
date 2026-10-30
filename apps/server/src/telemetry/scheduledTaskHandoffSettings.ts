// A saved task reports its real binding; a rejected call reports only an explicit choice.
export function scheduledTaskHandoffSettings(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) {
  const boundThreadId = output.boundThreadId;
  if (boundThreadId === null || typeof boundThreadId === "string")
    return { bindToCurrentThread: boundThreadId !== null };
  return typeof input.bindToCurrentThread === "boolean"
    ? { bindToCurrentThread: input.bindToCurrentThread }
    : {};
}
