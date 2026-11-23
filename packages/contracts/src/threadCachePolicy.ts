import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ForwardCompatibleOptional, ThreadId } from "./baseSchemas.ts";

const ThreadCachePolicy = Schema.Literals(["default", "warm", "compact", "off"]);

/** Idle minutes before a Keep-warm Codex thread is warmed; Codex reports no cache lifetime. */
const DEFAULT_CODEX_CACHE_WARM_AFTER_MINUTES = 115;
const CodexCacheWarmAfterMinutes = Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 720 }));

const NeonCacheWarmAfterMinutes = Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 55 }));

const IdleThreadMode = Schema.Literals(["off", "warm", "compact"]);
const idleProviderFields = {
  idleMinutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 720 })),
  minContextTokens: Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 10_000_000 })),
};
const IdleProviderSettings = Schema.Struct(idleProviderFields);
const IdleProviderPatch = Schema.Struct({
  idleMinutes: Schema.optionalKey(idleProviderFields.idleMinutes),
  minContextTokens: Schema.optionalKey(idleProviderFields.minContextTokens),
});
const MachineIdlePolicy = Schema.Struct({
  mode: IdleThreadMode,
  claudeAgent: IdleProviderSettings,
  codex: IdleProviderSettings,
  antigravity: IdleProviderSettings,
});
const MachineIdlePolicyPatch = Schema.Struct({
  mode: Schema.optionalKey(IdleThreadMode),
  claudeAgent: Schema.optionalKey(IdleProviderPatch),
  codex: Schema.optionalKey(IdleProviderPatch),
  antigravity: Schema.optionalKey(IdleProviderPatch),
});

export const threadCachePolicySettings = {
  machineIdlePolicy: ForwardCompatibleOptional(MachineIdlePolicy),
  threadCachePolicies: Schema.Record(ThreadId, ThreadCachePolicy).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  neonCacheWarmAfterMinutes: NeonCacheWarmAfterMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(50)),
  ),
  codexCacheWarmAfterMinutes: CodexCacheWarmAfterMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_CODEX_CACHE_WARM_AFTER_MINUTES)),
  ),
};

export const threadCachePolicyPatch = {
  machineIdlePolicy: Schema.optionalKey(MachineIdlePolicyPatch),
  threadCachePolicies: Schema.optionalKey(
    Schema.Record(ThreadId, Schema.NullOr(ThreadCachePolicy)),
  ),
  codexCacheWarmAfterMinutes: Schema.optionalKey(CodexCacheWarmAfterMinutes),
  neonCacheWarmAfterMinutes: Schema.optionalKey(NeonCacheWarmAfterMinutes),
};
