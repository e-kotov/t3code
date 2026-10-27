import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveAntigravityInstanceDirectories } from "../../provider/antigravityAuthSupport.ts";
import { withAntigravityTurnUsage } from "./AntigravityTurnUsage.ts";

function protoNumber(field: number, value: number): number[] {
  const varint = (number: number) => {
    const bytes: number[] = [];
    do {
      const byte = number % 128;
      number = Math.floor(number / 128);
      bytes.push(byte + (number > 0 ? 128 : 0));
    } while (number > 0);
    return bytes;
  };
  return [...varint(field * 8), ...varint(value)];
}

function protoBytes(field: number, bytes: readonly number[]): number[] {
  const encoded = protoNumber(field, bytes.length);
  encoded[0] = encoded[0]! + 2;
  return [...encoded, ...bytes];
}

function generation(usage: {
  readonly uncached: number;
  readonly output: number;
  readonly creation: number;
  readonly cached: number;
}) {
  return new Uint8Array(
    protoBytes(1, [
      ...protoBytes(4, [
        ...protoNumber(2, usage.uncached),
        ...protoNumber(3, usage.output),
        ...protoNumber(4, usage.creation),
        ...protoNumber(5, usage.cached),
      ]),
    ]),
  );
}

const insertGeneration = (filename: string, data: Uint8Array, idx?: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(
      "CREATE TABLE IF NOT EXISTS gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)",
    );
    if (idx !== undefined) {
      yield* sql.unsafe("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)", [idx, data]);
    } else {
      yield* sql.unsafe(
        "INSERT INTO gen_metadata (idx, data) VALUES (COALESCE((SELECT MAX(idx) + 1 FROM gen_metadata), 0), ?)",
        [data],
      );
    }
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));

const instanceId = ProviderInstanceId.make("antigravity");
const sessionId = "3f2b8c1e-4d5a-4b6c-8e7f-9a0b1c2d3e4f";
const providerThreadId = ProviderThreadId.make("provider-thread:antigravity-usage");
const modelSelection = { instanceId, model: "gemini-3.1-pro-high" };
const contextUsage = { usedTokens: 120_000, maxTokens: 1_048_576 };

const providerThread = {
  id: providerThreadId,
  nativeThreadRef: { nativeId: sessionId },
  contextUsage: null,
} as unknown as OrchestrationV2ProviderThread;

const driver = ProviderDriverKind.make("antigravity");

const turnEvent = (
  id: string,
  status: OrchestrationV2ProviderTurn["status"],
  completedAt: DateTime.Utc | null = null,
): ProviderAdapter.ProviderAdapterV2Event => ({
  type: "provider_turn.updated",
  driver,
  providerTurn: {
    id: ProviderTurnId.make(id),
    providerThreadId,
    status,
    completedAt,
  } as OrchestrationV2ProviderTurn,
});

const threadEvent = (
  usage: { readonly usedTokens: number; readonly maxTokens: number },
  updatedAt: string,
): ProviderAdapter.ProviderAdapterV2Event => ({
  type: "provider_thread.updated",
  driver,
  providerThread: {
    ...providerThread,
    contextUsage: usage,
    updatedAt: DateTime.makeUnsafe(updatedAt),
  },
});

const tokenUsageOf = (event: ProviderAdapter.ProviderAdapterV2Event | undefined) =>
  event?.type === "provider_turn.updated" ? event.providerTurn.tokenUsage : undefined;

const finalRequest = generation({ uncached: 2_000, output: 300, creation: 500, cached: 117_500 });
const finalRequestUsage = (updatedAt: string) => ({
  cacheScopeKey: "antigravity:gemini-3.1-pro-high",
  usedTokens: 120_000,
  maxTokens: 1_048_576,
  inputTokens: 120_000,
  cachedInputTokens: 117_500,
  cacheCreationTokens: 500,
  outputTokens: 300,
  reasoningOutputTokens: 0,
  updatedAt,
});

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "antigravity-usage-" });
  const { profile } = yield* resolveAntigravityInstanceDirectories(stateDir, instanceId);
  const conversations = path.join(profile, "antigravity-acp", "conversations");
  yield* fileSystem.makeDirectory(conversations, { recursive: true });
  const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
  const runtime = {
    events: Stream.fromQueue(events),
    startTurn: () => Effect.void,
  } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
  const adapter = yield* withAntigravityTurnUsage(
    {
      openSession: () => Effect.succeed(runtime),
    } as unknown as ProviderAdapter.ProviderAdapterV2["Service"],
    {
      instanceId,
      crypto,
      fileSystem,
      path,
      host: { paths: { stateDir } } as unknown as ProviderHost.ProviderHost["Service"],
    },
  );
  const session = yield* adapter.openSession(
    {} as ProviderAdapter.ProviderAdapterV2OpenSessionInput,
  );
  const startTurn = () =>
    session.startTurn({
      providerThread,
      modelSelection,
    } as unknown as ProviderAdapter.ProviderAdapterV2TurnInput);
  const emit = (
    emitted: ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>,
    outputs = emitted.length,
  ) =>
    Effect.gen(function* () {
      yield* Queue.offerAll(events, emitted);
      return yield* session.events.pipe(Stream.take(outputs), Stream.runCollect);
    });
  return {
    database: path.join(conversations, `${sessionId}.db`),
    startTurn,
    emit,
  };
});

const layer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("reports the first generation (idx=0) on a fresh session", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    yield* startTurn();
    yield* insertGeneration(database, finalRequest);
    const [, settled] = yield* emit([
      threadEvent(contextUsage, "2026-10-27T14:59:00.000Z"),
      turnEvent("provider-turn:1", "completed", DateTime.makeUnsafe("2026-10-27T15:00:00.000Z")),
    ]);
    assert.deepStrictEqual(tokenUsageOf(settled), finalRequestUsage("2026-10-27T15:00:00.000Z"));
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("reports the turn's newest generation as its last request", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    yield* insertGeneration(
      database,
      generation({ uncached: 1, output: 1, creation: 0, cached: 0 }),
    );
    yield* startTurn();
    yield* insertGeneration(
      database,
      generation({ uncached: 90_000, output: 50, creation: 0, cached: 0 }),
    );
    yield* insertGeneration(database, finalRequest);
    const [, settled] = yield* emit([
      threadEvent(contextUsage, "2026-10-27T14:59:00.000Z"),
      turnEvent("provider-turn:1", "completed", DateTime.makeUnsafe("2026-10-27T15:00:00.000Z")),
    ]);
    assert.deepStrictEqual(tokenUsageOf(settled), finalRequestUsage("2026-10-27T15:00:00.000Z"));
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("follows the live context size while a turn runs", () =>
  Effect.gen(function* () {
    const { startTurn, emit } = yield* setup;
    yield* startTurn();
    const [running, threadUpdate, refreshed] = yield* emit(
      [
        turnEvent("provider-turn:1", "running"),
        threadEvent({ usedTokens: 130_000, maxTokens: 1_048_576 }, "2026-10-27T15:01:00.000Z"),
      ],
      3,
    );
    assert.isUndefined(tokenUsageOf(running));
    assert.strictEqual(threadUpdate?.type, "provider_thread.updated");
    assert.strictEqual(
      refreshed?.type === "provider_turn.updated" && refreshed.providerTurn.status,
      "running",
    );
    // Zero request counters update the context without replacing the last request.
    assert.deepStrictEqual(tokenUsageOf(refreshed), {
      cacheScopeKey: "antigravity:gemini-3.1-pro-high",
      usedTokens: 130_000,
      maxTokens: 1_048_576,
      inputTokens: 0,
      updatedAt: "2026-10-27T15:01:00.000Z",
    });
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("repeats a settled turn's report and gives a later turn only its own generation", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    yield* startTurn();
    yield* insertGeneration(database, finalRequest);
    const completedAt = DateTime.makeUnsafe("2026-10-27T15:00:00.000Z");
    const [, first, repeated, compaction] = yield* emit([
      threadEvent(contextUsage, "2026-10-27T14:59:00.000Z"),
      turnEvent("provider-turn:1", "completed", completedAt),
      turnEvent("provider-turn:1", "completed", completedAt),
      turnEvent("provider-turn:2", "completed", DateTime.makeUnsafe("2026-10-27T15:02:00.000Z")),
    ]);
    assert.deepStrictEqual(tokenUsageOf(first), finalRequestUsage("2026-10-27T15:00:00.000Z"));
    assert.deepStrictEqual(tokenUsageOf(repeated), tokenUsageOf(first));
    assert.deepStrictEqual(tokenUsageOf(compaction), {
      cacheScopeKey: "antigravity:gemini-3.1-pro-high",
      usedTokens: 120_000,
      maxTokens: 1_048_576,
      inputTokens: 0,
      updatedAt: "2026-10-27T15:02:00.000Z",
    });
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("leaves a turn without a generation or known context without usage", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    yield* insertGeneration(database, finalRequest);
    yield* startTurn();
    const [settled] = yield* emit([
      turnEvent("provider-turn:2", "interrupted", DateTime.makeUnsafe("2026-10-27T15:05:00Z")),
    ]);
    assert.strictEqual(settled?.type, "provider_turn.updated");
    assert.isUndefined(tokenUsageOf(settled));
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
