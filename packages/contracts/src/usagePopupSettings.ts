import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const DEFAULT_USAGE_POPUP_HOVER_DELAY_MS = 300;
const MIN_USAGE_POPUP_HOVER_DELAY_MS = 0;
const MAX_USAGE_POPUP_HOVER_DELAY_MS = 5000;

export const UsagePopupHoverDelayMs = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_USAGE_POPUP_HOVER_DELAY_MS,
    maximum: MAX_USAGE_POPUP_HOVER_DELAY_MS,
  }),
);

export const usagePopupSettings = {
  usagePopupEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  usagePopupHoverDelayMs: UsagePopupHoverDelayMs.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_USAGE_POPUP_HOVER_DELAY_MS)),
  ),
};

export const usagePopupPatch = {
  usagePopupEnabled: Schema.optionalKey(Schema.Boolean),
  usagePopupHoverDelayMs: Schema.optionalKey(UsagePopupHoverDelayMs),
};
