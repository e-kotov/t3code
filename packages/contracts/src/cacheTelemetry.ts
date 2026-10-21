import * as Schema from "effect/Schema";
import { NonNegativeInt } from "./baseSchemas.ts";

export const CodexCacheFirstRequest = Schema.Struct({
  startedAt: Schema.String,
  reportedAt: Schema.String,
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
});

export const CodexCacheResumeObservation = Schema.Struct({
  ...CodexCacheFirstRequest.fields,
  gapMs: NonNegativeInt,
});
