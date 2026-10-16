import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const UTILITY_OUTPUT_LIMIT = 32_768;
export const UTILITY_CONFIG_LIMIT = 65_536;
export const UTILITY_CONFIG_PATH = ".config/t3-utilities/dashboard.json";
export const UtilityHealth = Schema.Literals(["healthy", "warning", "down", "unknown", "inactive"]);
export type UtilityHealth = typeof UtilityHealth.Type;
const limited = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum));
const text = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const command = TrimmedNonEmptyString.check(Schema.isMaxLength(4096));
const seconds = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));
export const UtilityAction = Schema.Struct({
  id: text,
  name: text,
  command,
  scope: Schema.Literals(["device", "shared"]),
  confirm: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  timeoutSeconds: seconds(1, 600).pipe(Schema.withDecodingDefault(Effect.succeed(120))),
});
export type UtilityAction = typeof UtilityAction.Type;
export const UtilityService = Schema.Struct({
  id: text,
  name: text,
  target: text,
  check: command,
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Zero means refresh only on opening or explicit Check now. */
  intervalSeconds: seconds(0, 86400).pipe(Schema.withDecodingDefault(Effect.succeed(60))),
  staleAfterSeconds: seconds(10, 86400).pipe(Schema.withDecodingDefault(Effect.succeed(120))),
  timeoutSeconds: seconds(1, 120).pipe(Schema.withDecodingDefault(Effect.succeed(30))),
  actions: Schema.Array(UtilityAction)
    .check(Schema.isMaxLength(10))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type UtilityService = typeof UtilityService.Type;
export const UtilityConfig = Schema.Struct({
  version: Schema.Literal(1),
  services: Schema.Array(UtilityService).check(Schema.isMaxLength(20)),
});
export type UtilityConfig = typeof UtilityConfig.Type;
const timestamp = Schema.NullOr(limited(64)).pipe(Schema.withDecodingDefault(Effect.succeed(null)));
export const UtilityCheck = Schema.Struct({
  id: text,
  name: text,
  status: UtilityHealth,
  summary: limited(2048),
  required: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export const UtilityResult = Schema.Struct({
  id: text,
  status: UtilityHealth,
  summary: limited(2048),
  startedAt: timestamp,
  lastRestartedAt: timestamp,
  checks: Schema.Array(UtilityCheck)
    .check(Schema.isMaxLength(20))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type UtilityResult = typeof UtilityResult.Type;
export const UtilityReport = Schema.Struct({
  version: Schema.Literal(1),
  services: Schema.Array(UtilityResult).check(Schema.isMaxLength(20)),
});
export const UtilityExecution = Schema.Struct({
  runId: Schema.String,
  revision: NonNegativeInt,
  serviceId: Schema.String,
  actionId: Schema.NullOr(Schema.String),
  startedAt: NonNegativeInt,
  finishedAt: Schema.NullOr(NonNegativeInt),
  exitCode: Schema.NullOr(Schema.Int),
  error: Schema.NullOr(Schema.String),
  stdout: limited(UTILITY_OUTPUT_LIMIT),
  stderr: limited(UTILITY_OUTPUT_LIMIT),
  truncated: Schema.Boolean,
});
export type UtilityExecution = typeof UtilityExecution.Type;
export const UtilitySnapshot = Schema.Struct({
  config: Schema.NullOr(UtilityConfig),
  configPath: Schema.String,
  revision: NonNegativeInt,
  error: Schema.NullOr(Schema.String),
  checks: Schema.Array(UtilityExecution),
  actions: Schema.Array(UtilityExecution),
});
export type UtilitySnapshot = typeof UtilitySnapshot.Type;
export interface DeviceUtilitiesBridge {
  snapshot(): Promise<UtilitySnapshot>;
  reload(): Promise<UtilitySnapshot>;
  active(active: boolean): Promise<void>;
  check(): Promise<void>;
  action(serviceId: string, actionId: string, revision: number): Promise<void>;
}

const decodeConfig = Schema.decodeUnknownSync(UtilityConfig);
const decodeReport = Schema.decodeUnknownSync(UtilityReport);
function unique(ids: ReadonlyArray<string>) {
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate utility IDs.");
}
export function decodeUtilityConfig(raw: string): UtilityConfig {
  if (raw.length > UTILITY_CONFIG_LIMIT) throw new Error("Utility configuration exceeds 64 KiB.");
  const value = decodeConfig(JSON.parse(raw));
  unique(value.services.map((s) => s.id));
  for (const service of value.services) {
    unique(service.actions.map((a) => a.id));
    if (service.intervalSeconds > 0 && service.intervalSeconds < 10)
      throw new Error("Polling interval must be zero or at least 10 seconds.");
  }
  return value;
}
export function readUtilityResult(run: UtilityExecution, now: number): UtilityResult {
  if (run.finishedAt === null) throw new Error("Check is still running.");
  if (run.error) throw new Error(run.error);
  if (run.truncated) throw new Error("Check output was truncated or exceeded 32 KiB.");
  if (run.exitCode !== 0) throw new Error(`Check failed (exit ${run.exitCode ?? "unknown"}).`);
  const report = decodeReport(JSON.parse(run.stdout));
  unique(report.services.map((s) => s.id));
  const result = report.services.find((s) => s.id === run.serviceId);
  if (!result) throw new Error("Expected service ID is missing from check output.");
  unique(result.checks.map((c) => c.id));
  for (const stamp of [result.startedAt, result.lastRestartedAt]) {
    if (
      stamp !== null &&
      (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(stamp) ||
        !Number.isFinite(Date.parse(stamp)) ||
        Date.parse(stamp) > now + 300_000)
    )
      throw new Error("Invalid or future service timestamp.");
  }
  return result;
}
export type UtilityDisplayStatus = UtilityHealth | "stale";
export function utilityObservation(
  service: UtilityService,
  run: UtilityExecution | undefined,
  now: number,
) {
  if (!service.enabled)
    return { status: "inactive" as const, result: null, reason: "Disabled in configuration." };
  if (!run) return { status: "unknown" as const, result: null, reason: "No observation yet." };
  let result: UtilityResult;
  try {
    result = readUtilityResult(run, now);
  } catch (cause) {
    return {
      status: "unknown" as const,
      result: null,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
  if (now - run.startedAt > service.staleAfterSeconds * 1000)
    return {
      status: "stale" as const,
      result,
      reason: "Last observation expired; current health is unknown.",
    };
  return { status: result.status, result, reason: result.summary };
}
export function utilityAggregate(
  statuses: ReadonlyArray<UtilityDisplayStatus>,
): "healthy" | "down" | "mixed" | "unknown" {
  const active = statuses.filter((s) => s !== "inactive");
  if (!active.length || active.every((s) => s === "unknown" || s === "stale")) return "unknown";
  if (active.every((s) => s === "healthy")) return "healthy";
  if (active.every((s) => s === "down")) return "down";
  return "mixed";
}
export function utilityStatuses(snapshot: UtilitySnapshot, now: number) {
  return (snapshot.config?.services ?? []).map(
    (s) => utilityServiceObservation(snapshot, s, now).status,
  );
}
export function utilityServiceObservation(
  snapshot: UtilitySnapshot,
  service: UtilityService,
  now: number,
) {
  const observation = utilityObservation(
    service,
    snapshot.checks.find((r) => r.serviceId === service.id),
    now,
  );
  if (snapshot.error) return { ...observation, status: "unknown" as const, reason: snapshot.error };
  if (snapshot.actions.some((r) => r.serviceId === service.id && r.finishedAt === null))
    return {
      ...observation,
      status: "unknown" as const,
      reason: "Action running; awaiting a fresh health check.",
    };
  return observation;
}
export function utilityTime(value: string | null, now: number): string {
  if (!value) return "Unknown · not reported";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown · invalid timestamp";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  const age =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
          : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h ago`;
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(timestamp)} · ${age}`;
}
