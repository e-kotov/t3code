import type {
  ModelSelection,
  OrchestrationV2ProviderTurnTokenUsage,
  ProviderInstanceId,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveAntigravityInstanceDirectories } from "../../provider/antigravityAuthSupport.ts";
import { metadata, usageCandidates } from "../../provider/Drivers/antigravityUsageReader.ts";

// Fork-owned, mounted by AntigravityAdapterV2.ts. ACP reports context size only, so the
// cache counts come from the session's newest gen_metadata row when a turn settles.

type Adapter = ProviderAdapter.ProviderAdapterV2["Service"];
type SessionRuntime = ProviderAdapter.ProviderAdapterV2SessionRuntime;
type AdapterEvent = ProviderAdapter.ProviderAdapterV2Event;

interface TurnStart {
  sessionId: string | undefined;
  // A turn that wrote no generation must not inherit the previous turn's request.
  readonly baselineRowId: number;
  readonly modelSelection: ModelSelection;
  contextUsage: ThreadTokenUsageSnapshot | null;
}

const SETTLED_STATUSES: ReadonlySet<string> = new Set(["completed", "interrupted", "failed"]);

const firstGenerationRow = Effect.fn("AntigravityTurnUsage.firstGenerationRow")(function* <
  A extends object,
>(filename: string, query: string) {
  const rows = yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe("PRAGMA busy_timeout = 100");
    return yield* sql.unsafe<A>(query);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename, readonly: true })));
  return rows[0];
});

/** A session without a database or generations yet starts from zero. */
const latestAntigravityGenerationRowId = Effect.fn("latestAntigravityGenerationRowId")(function* (
  filename: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  if (!(yield* fileSystem.exists(filename))) return 0;
  const row = yield* firstGenerationRow<{ readonly row_id: number | null }>(
    filename,
    "SELECT MAX(rowid) AS row_id FROM gen_metadata",
  );
  return row?.row_id ?? 0;
});

/** Decodes only the newest row; the usage reader's scan decodes the whole conversation. */
const readLatestAntigravityGeneration = Effect.fn("readLatestAntigravityGeneration")(function* (
  filename: string,
  sessionId: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  if (!(yield* fileSystem.exists(filename))) return undefined;
  const row = yield* firstGenerationRow<{ readonly row_id: number; readonly data: unknown }>(
    filename,
    "SELECT rowid AS row_id, data FROM gen_metadata ORDER BY rowid DESC LIMIT 1",
  );
  const data = row?.data;
  if (row === undefined || !(data instanceof Uint8Array)) return undefined;
  const candidate = yield* Effect.try(
    () => usageCandidates(sessionId, [{ idx: 0, entry: metadata(data, false) }], [], null, 0)[0],
  );
  return candidate === undefined
    ? undefined
    : { rowId: row.row_id, totals: candidate.record.totals };
});

function antigravityTurnTokenUsage(input: {
  readonly totals: {
    readonly uncachedInputTokens: number;
    readonly cachedInputTokens: number;
    readonly cacheCreationTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  };
  readonly contextUsage: ThreadTokenUsageSnapshot | null;
  readonly modelSelection: ModelSelection;
  readonly updatedAt: string;
}): OrchestrationV2ProviderTurnTokenUsage {
  const { totals, contextUsage } = input;
  // Same convention as Claude: input includes cache reads and writes.
  const inputTokens =
    totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationTokens;
  const maxTokens = contextUsage?.maxTokens;
  return {
    cacheScopeKey: `${input.modelSelection.instanceId}:${input.modelSelection.model}`,
    usedTokens: contextUsage?.usedTokens ?? inputTokens + totals.outputTokens,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    outputTokens: totals.outputTokens,
    reasoningOutputTokens: totals.reasoningTokens,
    updatedAt: input.updatedAt,
  };
}

export const withAntigravityTurnUsage = Effect.fn("withAntigravityTurnUsage")(function* (
  adapter: Adapter,
  services: {
    readonly instanceId: ProviderInstanceId;
    readonly crypto: Crypto.Crypto;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly host: ProviderHost.ProviderHost["Service"];
  },
) {
  const directories = yield* resolveAntigravityInstanceDirectories(
    services.host.paths.stateDir,
    services.instanceId,
  ).pipe(
    Effect.provideService(Crypto.Crypto, services.crypto),
    Effect.provideService(Path.Path, services.path),
    Effect.option,
  );
  if (Option.isNone(directories)) return adapter;
  const conversations = services.path.join(
    directories.value.profile,
    "antigravity-acp",
    "conversations",
  );
  const database = (sessionId: string) => services.path.join(conversations, `${sessionId}.db`);
  const quietly = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>, fallback: A) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, services.fileSystem),
      Effect.tapCause((cause) =>
        Effect.logDebug("Could not read Antigravity generation usage.", cause),
      ),
      Effect.orElseSucceed(() => fallback),
    );

  const wrapRuntime = (runtime: SessionRuntime): SessionRuntime => {
    const turns = new Map<string, TurnStart>();
    const enrich = Effect.fn("AntigravityTurnUsage.enrich")(function* (event: AdapterEvent) {
      if (event.type === "provider_thread.updated") {
        const turn = turns.get(event.providerThread.id);
        if (turn !== undefined) {
          turn.sessionId ??= event.providerThread.nativeThreadRef?.nativeId ?? undefined;
          turn.contextUsage = event.providerThread.contextUsage ?? turn.contextUsage;
        }
        return event;
      }
      if (
        event.type !== "provider_turn.updated" ||
        event.providerTurn.tokenUsage !== undefined ||
        !SETTLED_STATUSES.has(event.providerTurn.status)
      ) {
        return event;
      }
      const turn = turns.get(event.providerTurn.providerThreadId);
      if (turn?.sessionId === undefined) return event;
      const generation = yield* quietly(
        readLatestAntigravityGeneration(database(turn.sessionId), turn.sessionId),
        undefined,
      );
      if (generation === undefined || generation.rowId <= turn.baselineRowId) return event;
      const completedAt = event.providerTurn.completedAt ?? (yield* DateTime.now);
      const tokenUsage = antigravityTurnTokenUsage({
        totals: generation.totals,
        contextUsage: turn.contextUsage,
        modelSelection: turn.modelSelection,
        updatedAt: DateTime.formatIso(completedAt),
      });
      return { ...event, providerTurn: { ...event.providerTurn, tokenUsage } };
    });
    const enrichStream = <E>(events: Stream.Stream<AdapterEvent, E>) =>
      events.pipe(Stream.mapEffect(enrich));
    return {
      ...runtime,
      events: enrichStream(runtime.events),
      ...(runtime.subscribeEvents === undefined
        ? {}
        : {
            subscribeEvents: runtime.subscribeEvents.pipe(
              Effect.map((subscription) => ({
                ...subscription,
                events: enrichStream(subscription.events),
              })),
            ),
          }),
      startTurn: Effect.fn("AntigravityTurnUsage.startTurn")(function* (turnInput) {
        const sessionId = turnInput.providerThread.nativeThreadRef?.nativeId ?? undefined;
        const baselineRowId =
          sessionId === undefined
            ? 0
            : yield* quietly(latestAntigravityGenerationRowId(database(sessionId)), 0);
        turns.set(turnInput.providerThread.id, {
          sessionId,
          baselineRowId,
          modelSelection: turnInput.modelSelection,
          contextUsage: turnInput.providerThread.contextUsage ?? null,
        });
        return yield* runtime.startTurn(turnInput);
      }),
    };
  };

  return {
    ...adapter,
    openSession: (input: ProviderAdapter.ProviderAdapterV2OpenSessionInput) =>
      adapter.openSession(input).pipe(Effect.map(wrapRuntime)),
  } satisfies Adapter;
});
