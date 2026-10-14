import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Live allocation state, never a persisted environment name or setting. */
export const SlurmJobStatus = Schema.Struct({
  jobId: TrimmedNonEmptyString,
  state: Schema.Literals(["running", "suspended", "ended", "unknown"]),
  /** Null means unlimited for a running job, unavailable for an unknown job. */
  remainingSeconds: Schema.NullOr(NonNegativeInt),
  observedAt: NonNegativeInt,
  /** Server time at delivery lets clients measure age without agreeing on UTC. */
  serverNow: NonNegativeInt,
});
export type SlurmJobStatus = typeof SlurmJobStatus.Type;

export const SlurmJobStatusUpdated = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("slurmJobStatusUpdated"),
  payload: Schema.NullOr(SlurmJobStatus),
});
