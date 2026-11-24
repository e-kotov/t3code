// The EK fork turns off Codex's own analytics, feedback uploads and metrics export.
// They follow launch args, so a user's -c cannot turn them back on.
export const FORK_CODEX_TELEMETRY_OFF_ARGS: ReadonlyArray<string> = [
  "-c",
  "analytics.enabled=false",
  "-c",
  "feedback.enabled=false",
  "-c",
  'otel.metrics_exporter="none"',
];

export const withForkCodexTelemetryOff = (args: ReadonlyArray<string>) => [
  ...args,
  ...FORK_CODEX_TELEMETRY_OFF_ARGS,
];
