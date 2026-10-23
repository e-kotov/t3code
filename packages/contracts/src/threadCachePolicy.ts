import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

const ThreadCachePolicy = Schema.Literals(["default", "warm", "compact", "off"]);

export const threadCachePolicySettings = {
  threadCachePolicies: Schema.Record(ThreadId, ThreadCachePolicy).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
};

export const threadCachePolicyPatch = {
  threadCachePolicies: Schema.optionalKey(
    Schema.Record(ThreadId, Schema.NullOr(ThreadCachePolicy)),
  ),
};
