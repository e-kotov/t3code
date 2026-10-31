import * as Schema from "effect/Schema";

export const ForkThreadQuota = Schema.Struct({
  status: Schema.Literals(["available", "partial", "unavailable", "unsupported"]),
  checkedAt: Schema.String,
  dataAsOf: Schema.NullOr(Schema.String),
  fiveHourPercent: Schema.NullOr(Schema.Finite),
  weeklyPercent: Schema.NullOr(Schema.Finite),
  balanceCredits: Schema.NullOr(Schema.String),
});
export type ForkThreadQuota = typeof ForkThreadQuota.Type;
