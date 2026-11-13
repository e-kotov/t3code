import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const SettleNavigation = Schema.Literals(["stay", "new-chat", "next-thread"]);
type SettleNavigation = typeof SettleNavigation.Type;
// The fork keeps the settled thread open so settling never marks another thread read.
const DEFAULT_SETTLE_NAVIGATION: SettleNavigation = "stay";

export const settleNavigationSettings = {
  settleNavigation: SettleNavigation.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SETTLE_NAVIGATION)),
  ),
};

export const settleNavigationPatch = {
  settleNavigation: Schema.optionalKey(SettleNavigation),
};
