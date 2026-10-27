import {
  ModelSelection,
  type OrchestrationV2CacheHud,
  OrchestrationV2ProviderTurnTokenUsage,
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  ThreadId,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import { deriveCacheHud, reportFromContextUsage } from "@t3tools/shared/cacheHud";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";

const decodeDriver = Schema.decodeEffect(ProviderDriverKind);
const decodeModel = Schema.decodeEffect(Schema.fromJsonString(ModelSelection));
const decodeUsage = Schema.decodeEffect(
  Schema.fromJsonString(OrchestrationV2ProviderTurnTokenUsage),
);
const decodeContextUsage = Schema.decodeOption(Schema.fromJsonString(ThreadTokenUsageSnapshot));

// Fork-owned cache HUD reads mounted by ProjectionStore.ts. Only the active
// provider thread counts, which prevents stale clocks after forks/switches.

export function cacheHudFromProjection(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2CacheHud | null {
  const provider = projection.providerThreads.find(
    (entry) => entry.id === projection.thread.activeProviderThreadId,
  );
  if (!provider) return null;
  const turnReports = projection.providerTurns
    .filter((turn) => turn.providerThreadId === provider.id)
    .flatMap((turn) => (turn.tokenUsage ? [turn.tokenUsage] : []));
  const reports =
    turnReports.length > 0
      ? turnReports
      : provider.contextUsage
        ? [reportFromContextUsage(provider.contextUsage, DateTime.formatIso(provider.updatedAt))]
        : [];
  return deriveCacheHud(provider.driver, reports, projection.thread.modelSelection);
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
    usage_json: string | null;
    context_usage_json: string | null;
    provider_updated_at: string;
  }>`
      SELECT t.thread_id, p.driver,
        json_extract(t.payload_json, '$.modelSelection') AS model_json,
        json_extract(u.payload_json, '$.tokenUsage') AS usage_json,
        json_extract(p.payload_json, '$.contextUsage') AS context_usage_json,
        p.updated_at AS provider_updated_at
      FROM orchestration_v2_projection_threads t
      JOIN orchestration_v2_projection_provider_threads p
        ON p.provider_thread_id = t.active_provider_thread_id
      LEFT JOIN orchestration_v2_projection_provider_turns u ON u.provider_turn_id IN (
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
    const usageJson = group.flatMap((row) => (row.usage_json === null ? [] : [row.usage_json]));
    const contextUsage =
      first.context_usage_json === null
        ? Option.none()
        : decodeContextUsage(first.context_usage_json);
    const reports =
      usageJson.length > 0
        ? yield* Effect.forEach(usageJson, (json) => decodeUsage(json))
        : Option.isSome(contextUsage)
          ? [reportFromContextUsage(contextUsage.value, first.provider_updated_at)]
          : [];
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
