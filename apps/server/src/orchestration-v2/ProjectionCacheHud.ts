import {
  ModelSelection,
  type OrchestrationV2CacheHud,
  OrchestrationV2ProviderTurnTokenUsage,
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import { deriveCacheHud } from "@t3tools/shared/cacheHud";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

const decodeDriver = Schema.decodeEffect(ProviderDriverKind);
const decodeModel = Schema.decodeEffect(Schema.fromJsonString(ModelSelection));
const decodeUsage = Schema.decodeEffect(
  Schema.fromJsonString(OrchestrationV2ProviderTurnTokenUsage),
);

// Fork-owned cache HUD reads mounted by ProjectionStore.ts. Only the active
// provider thread counts, which prevents stale clocks after forks/switches.

export function cacheHudFromProjection(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2CacheHud | null {
  const provider = projection.providerThreads.find(
    (entry) => entry.id === projection.thread.activeProviderThreadId,
  );
  return provider
    ? deriveCacheHud(
        provider.driver,
        projection.providerTurns
          .filter((turn) => turn.providerThreadId === provider.id)
          .flatMap((turn) => (turn.tokenUsage ? [turn.tokenUsage] : [])),
        projection.thread.modelSelection,
      )
    : null;
}

// Only token metadata from a bounded recent window crosses into the shell.
export const cacheHudsForThreads = Effect.fn("cacheHudsForThreads")(function* (
  sql: SqlClient.SqlClient,
  threadIds: ReadonlyArray<ThreadId>,
) {
  const result = new Map<ThreadId, OrchestrationV2CacheHud | null>();
  if (threadIds.length === 0) return result;
  const rows = yield* sql<{
    thread_id: string;
    driver: string;
    model_json: string;
    usage_json: string;
  }>`
      SELECT t.thread_id, p.driver,
        json_extract(t.payload_json, '$.modelSelection') AS model_json,
        json_extract(u.payload_json, '$.tokenUsage') AS usage_json
      FROM orchestration_v2_projection_threads t
      JOIN orchestration_v2_projection_provider_threads p
        ON p.provider_thread_id = t.active_provider_thread_id
      JOIN orchestration_v2_projection_provider_turns u ON u.provider_turn_id IN (
        SELECT recent.provider_turn_id
        FROM orchestration_v2_projection_provider_turns recent
        WHERE recent.provider_thread_id = p.provider_thread_id
          AND json_extract(recent.payload_json, '$.tokenUsage') IS NOT NULL
        ORDER BY recent.ordinal DESC LIMIT 64
      )
      WHERE t.thread_id IN ${sql.in(threadIds)}
    `;
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const group = groups.get(row.thread_id) ?? [];
    group.push(row);
    groups.set(row.thread_id, group);
  }
  for (const [id, group] of groups) {
    const first = group[0]!;
    const driver = yield* decodeDriver(first.driver);
    const model = yield* decodeModel(first.model_json);
    const reports = yield* Effect.forEach(group, (row) => decodeUsage(row.usage_json));
    result.set(ThreadId.make(id), deriveCacheHud(driver, reports, model));
  }
  return result;
});

export const withCacheHud =
  (cacheHuds: ReadonlyMap<ThreadId, OrchestrationV2CacheHud | null>) =>
  <Shell extends { readonly id: ThreadId }>(shell: Shell) => ({
    ...shell,
    cacheHud: cacheHuds.get(shell.id) ?? null,
  });
