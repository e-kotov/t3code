export function automationDestinationDimension(output: Readonly<Record<string, unknown>>) {
  if (output.boundThreadId === null) return { bindToCurrentThread: false };
  if (typeof output.boundThreadId === "string") return { bindToCurrentThread: true };
  return {};
}
