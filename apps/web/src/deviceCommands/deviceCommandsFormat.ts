import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
/** Compact age for the menu: "now", "5m", "3h", "2d". */
export function formatRunAge(timestamp: number, now: number, resolve: MessageResolver = m): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return resolve(msg("now"));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return resolve(msg("{minutes}m"), { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return resolve(msg("{hours}h"), { hours });
  return resolve(msg("{days}d"), { days: Math.floor(hours / 24) });
}

export function describeRunOutcome(
  run: {
    readonly status: "running" | "succeeded" | "failed" | "stopped";
    readonly exitCode: number | null;
  },
  resolve: MessageResolver = m,
): string {
  switch (run.status) {
    case "running":
      return resolve(msg("Running"));
    case "succeeded":
      return resolve(msg("Finished"));
    case "stopped":
      return resolve(msg("Stopped"));
    case "failed":
      return run.exitCode === null
        ? resolve(msg("Failed"))
        : resolve(msg("Failed with exit code {exitCode}"), { exitCode: run.exitCode });
  }
}
