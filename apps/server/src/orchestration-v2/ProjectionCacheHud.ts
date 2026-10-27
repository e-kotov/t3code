// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import {
  ModelSelection,
  type OrchestrationV2CacheHud,
  OrchestrationV2ProviderTurnTokenUsage,
  type OrchestrationV2ThreadProjection,
  ProviderDriverKind,
  ThreadId,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import { deriveCacheHud } from "@t3tools/shared/cacheHud";
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

function parseFields(bytes: Uint8Array): Map<number, (number | Uint8Array)[]> {
  let offset = 0;
  const result = new Map<number, (number | Uint8Array)[]>();
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = bytes[offset++];
      if (byte === undefined) return 0;
      value |= (byte & 127) << shift;
      if (byte < 128) return value;
    }
    return value;
  };
  while (offset < bytes.length) {
    const key = varint();
    const tag = key >>> 3;
    const wire = key & 7;
    if (wire === 0) {
      const val = varint();
      const entries = result.get(tag) ?? [];
      entries.push(val);
      result.set(tag, entries);
    } else if (wire === 2) {
      const len = varint();
      const val = bytes.subarray(offset, offset + len);
      offset += len;
      const entries = result.get(tag) ?? [];
      entries.push(val);
      result.set(tag, entries);
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return result;
}

function candidateAntigravityDirs(): string[] {
  const home = process.env.HOME || "";
  const t3UserData =
    process.env.T3_USERDATA_DIR || (home ? NodePath.join(home, ".t3", "userdata") : "");
  const dirs: string[] = [];
  if (t3UserData) {
    const providersDir = NodePath.join(t3UserData, "providers", "antigravity");
    if (NodeFS.existsSync(providersDir)) {
      try {
        const subdirs = NodeFS.readdirSync(providersDir);
        for (const subdir of subdirs) {
          const convDir = NodePath.join(providersDir, subdir, "antigravity-acp", "conversations");
          if (NodeFS.existsSync(convDir)) {
            dirs.push(convDir);
          }
        }
      } catch {}
    }
  }
  if (home) {
    for (const name of [
      "antigravity",
      "antigravity-cli",
      "antigravity-ide",
      "antigravity-backup",
    ]) {
      const convDir = NodePath.join(home, ".gemini", name, "conversations");
      if (NodeFS.existsSync(convDir)) dirs.push(convDir);
    }
    const configDir = NodePath.join(home, ".config", "antigravity", "conversations");
    if (NodeFS.existsSync(configDir)) dirs.push(configDir);
  }
  return dirs;
}

function findAntigravitySessionDb(nativeId: string): string | null {
  for (const dir of candidateAntigravityDirs()) {
    const file = NodePath.join(dir, `${nativeId}.db`);
    if (NodeFS.existsSync(file)) return file;
  }
  return null;
}

interface CachedAntigravitySessionUsage {
  readonly fingerprint: string;
  readonly stats: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheCreationTokens: number;
    readonly outputTokens: number;
    readonly updatedAt: string;
  } | null;
}

const antigravitySessionUsageCache = new Map<string, CachedAntigravitySessionUsage>();

function readAntigravitySessionCache(nativeId: string) {
  const file = findAntigravitySessionDb(nativeId);
  if (!file) return null;
  try {
    const stat = NodeFS.statSync(file);
    const wal = `${file}-wal`;
    const walMtime = NodeFS.existsSync(wal) ? NodeFS.statSync(wal).mtimeMs : 0;
    const fingerprint = `${stat.size}:${stat.mtimeMs}:${walMtime}`;
    const cached = antigravitySessionUsageCache.get(nativeId);
    if (cached && cached.fingerprint === fingerprint) return cached.stats;

    const db = new NodeSqlite.DatabaseSync(file, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout = 200;");
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);
      if (!tables.includes("gen_metadata")) {
        antigravitySessionUsageCache.set(nativeId, { fingerprint, stats: null });
        return null;
      }
      const row = db.prepare("SELECT data FROM gen_metadata ORDER BY rowid DESC LIMIT 1").get() as
        | { data: Uint8Array }
        | undefined;
      if (!row || !row.data) {
        antigravitySessionUsageCache.set(nativeId, { fingerprint, stats: null });
        return null;
      }
      const root = parseFields(row.data);
      const dataBytes = root.get(1)?.[0];
      if (!(dataBytes instanceof Uint8Array)) return null;
      const data = parseFields(dataBytes);
      const usageBytes = data.get(4)?.[0];
      if (!(usageBytes instanceof Uint8Array)) return null;
      const usage = parseFields(usageBytes);
      const uncached = (usage.get(2)?.[0] as number) ?? 0;
      const output = (usage.get(3)?.[0] as number) ?? 0;
      const creation = (usage.get(4)?.[0] as number) ?? 0;
      const cachedTokens = (usage.get(5)?.[0] as number) ?? 0;
      const inputTokens = uncached + cachedTokens;
      const stats = {
        inputTokens,
        cachedInputTokens: cachedTokens,
        cacheCreationTokens: creation,
        outputTokens: output,
        updatedAt: new Date(stat.mtimeMs).toISOString(),
      };
      antigravitySessionUsageCache.set(nativeId, { fingerprint, stats });
      return stats;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

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
  let reports = turnReports;
  if (reports.length === 0) {
    let fallbackReport: OrchestrationV2ProviderTurnTokenUsage | null = null;
    if (provider.driver === "antigravity" && provider.nativeThreadRef?.nativeId) {
      const stats = readAntigravitySessionCache(provider.nativeThreadRef.nativeId);
      if (stats) {
        fallbackReport = {
          usedTokens: provider.contextUsage?.usedTokens ?? stats.inputTokens + stats.outputTokens,
          maxTokens: provider.contextUsage?.maxTokens ?? 1_048_576,
          inputTokens: stats.inputTokens,
          cachedInputTokens: stats.cachedInputTokens,
          cacheCreationTokens: stats.cacheCreationTokens,
          outputTokens: stats.outputTokens,
          updatedAt:
            stats.updatedAt ??
            (typeof provider.updatedAt === "string"
              ? provider.updatedAt
              : DateTime.formatIso(provider.updatedAt as DateTime.Utc)),
        };
      }
    }
    if (!fallbackReport && provider.contextUsage) {
      fallbackReport = {
        usedTokens: provider.contextUsage.usedTokens,
        ...(provider.contextUsage.maxTokens !== undefined
          ? { maxTokens: provider.contextUsage.maxTokens }
          : {}),
        ...(provider.contextUsage.inputTokens !== undefined
          ? { inputTokens: provider.contextUsage.inputTokens }
          : {}),
        ...(provider.contextUsage.cachedInputTokens !== undefined
          ? { cachedInputTokens: provider.contextUsage.cachedInputTokens }
          : {}),
        updatedAt:
          typeof provider.updatedAt === "string"
            ? provider.updatedAt
            : DateTime.formatIso(provider.updatedAt as DateTime.Utc),
      };
    }
    if (fallbackReport) {
      reports = [fallbackReport];
    }
  }
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
    native_id: string | null;
    provider_updated_at: string;
  }>`
      SELECT t.thread_id, p.driver,
        json_extract(t.payload_json, '$.modelSelection') AS model_json,
        json_extract(u.payload_json, '$.tokenUsage') AS usage_json,
        json_extract(p.payload_json, '$.contextUsage') AS context_usage_json,
        json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS native_id,
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
  const now = yield* DateTime.now;
  const nowIso = DateTime.formatIso(now);
  for (const [id, group] of groups) {
    const first = group[0]!;
    const driver = yield* decodeDriver(first.driver);
    const model = yield* decodeModel(first.model_json);
    const validTurnUsages = group.filter((row) => row.usage_json != null);
    if (validTurnUsages.length > 0) {
      const reports = yield* Effect.forEach(validTurnUsages, (row) => decodeUsage(row.usage_json!));
      result.set(ThreadId.make(id), deriveCacheHud(driver, reports, model));
    } else {
      let fallbackReport: OrchestrationV2ProviderTurnTokenUsage | null = null;
      if (first.driver === "antigravity" && first.native_id) {
        const stats = readAntigravitySessionCache(first.native_id);
        if (stats) {
          const contextUsage = first.context_usage_json
            ? Option.getOrNull(decodeContextUsage(first.context_usage_json))
            : null;
          fallbackReport = {
            usedTokens: contextUsage?.usedTokens ?? stats.inputTokens + stats.outputTokens,
            maxTokens: contextUsage?.maxTokens ?? 1_048_576,
            inputTokens: stats.inputTokens,
            cachedInputTokens: stats.cachedInputTokens,
            cacheCreationTokens: stats.cacheCreationTokens,
            outputTokens: stats.outputTokens,
            updatedAt: stats.updatedAt ?? first.provider_updated_at ?? nowIso,
          };
        }
      }
      if (!fallbackReport && first.context_usage_json) {
        const parsed = Option.getOrNull(decodeContextUsage(first.context_usage_json));
        if (parsed !== null) {
          fallbackReport = {
            usedTokens: parsed.usedTokens,
            ...(parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {}),
            ...(parsed.inputTokens !== undefined ? { inputTokens: parsed.inputTokens } : {}),
            ...(parsed.cachedInputTokens !== undefined
              ? { cachedInputTokens: parsed.cachedInputTokens }
              : {}),
            updatedAt: first.provider_updated_at ?? nowIso,
          };
        }
      }
      result.set(
        ThreadId.make(id),
        fallbackReport ? deriveCacheHud(driver, [fallbackReport], model) : null,
      );
    }
  }
  return result;
});

export const withCacheHud =
  (cacheHuds: ReadonlyMap<ThreadId, OrchestrationV2CacheHud | null>) =>
  <Shell extends { readonly id: ThreadId }>(shell: Shell) => ({
    ...shell,
    cacheHud: cacheHuds.get(shell.id) ?? null,
  });
