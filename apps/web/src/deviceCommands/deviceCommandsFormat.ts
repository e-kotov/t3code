/** Compact age for the menu: "now", "5m", "3h", "2d". */
export function formatRunAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function describeRunOutcome(run: {
  readonly status: "running" | "succeeded" | "failed" | "stopped";
  readonly exitCode: number | null;
}): string {
  switch (run.status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Finished";
    case "stopped":
      return "Stopped";
    case "failed":
      return run.exitCode === null ? "Failed" : `Failed with exit code ${run.exitCode}`;
  }
}
