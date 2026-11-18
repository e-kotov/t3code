import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

const ThreadCachePolicy = Schema.Literals(["default", "warm", "compact", "off"]);

/** Idle minutes before a Keep-warm Codex thread is warmed; Codex reports no cache lifetime. */
const DEFAULT_CODEX_CACHE_WARM_AFTER_MINUTES = 115;
const CodexCacheWarmAfterMinutes = Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 720 }));

export const threadCachePolicySettings = {
  threadCachePolicies: Schema.Record(ThreadId, ThreadCachePolicy).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  codexCacheWarmAfterMinutes: CodexCacheWarmAfterMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CODEX_CACHE_WARM_AFTER_MINUTES)),
  ),
};

export const threadCachePolicyPatch = {
  threadCachePolicies: Schema.optionalKey(
    Schema.Record(ThreadId, Schema.NullOr(ThreadCachePolicy)),
  ),
  codexCacheWarmAfterMinutes: Schema.optionalKey(CodexCacheWarmAfterMinutes),
};
