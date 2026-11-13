import * as Schema from "effect/Schema";

import { EnvironmentId } from "./baseSchemas.ts";

/**
 * Fork: extends a still-valid direct pairing or agent-link session in place.
 * Bearer-only; an older host answers it with anything but this schema.
 */
export const FORK_SESSION_RENEWAL_PATH = "/api/fork/auth/session/renew";

/** `expiresIn` is in seconds, so the caller needs no clock agreement with the host. */
const Lifetime = {
  environmentId: EnvironmentId,
  expiresAt: Schema.String,
  expiresIn: Schema.Int,
};

export const ForkSessionRenewalResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("renewed"), token: Schema.String, ...Lifetime }),
  Schema.Struct({
    status: Schema.Literal("unchanged"),
    reason: Schema.Literals(["not_due", "cap_reached"]),
    ...Lifetime,
  }),
  Schema.Struct({
    status: Schema.Literal("refused"),
    environmentId: EnvironmentId,
    reason: Schema.Literals([
      "missing_credential",
      "invalid_credential",
      "not_renewable",
      "session_expired",
      "session_revoked",
    ]),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), environmentId: EnvironmentId }),
]);
export type ForkSessionRenewalResponse = typeof ForkSessionRenewalResponse.Type;
