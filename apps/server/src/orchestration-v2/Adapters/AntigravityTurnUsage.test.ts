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

const insertGeneration = (filename: string, data: Uint8Array) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe("CREATE TABLE IF NOT EXISTS gen_metadata (idx INTEGER, data BLOB)");
    yield* sql.unsafe("INSERT INTO gen_metadata (idx, data) VALUES (0, ?)", [data]);
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

const turnEvent = (
  id: string,
  status: OrchestrationV2ProviderTurn["status"],
  completedAt: DateTime.Utc,
): ProviderAdapter.ProviderAdapterV2Event => ({
  type: "provider_turn.updated",
  driver: ProviderDriverKind.make("antigravity"),
  providerTurn: {
    id: ProviderTurnId.make(id),
    providerThreadId,
    status,
    completedAt,
  } as OrchestrationV2ProviderTurn,
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
  const emit = (...emitted: ReadonlyArray<ProviderAdapter.ProviderAdapterV2Event>) =>
    Effect.gen(function* () {
      yield* Queue.offerAll(events, emitted);
      return yield* session.events.pipe(Stream.take(emitted.length), Stream.runCollect);
    });
  return {
    database: path.join(conversations, `${sessionId}.db`),
    startTurn,
    emit,
  };
});

const layer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("attaches the newest generation's cache counts to the settled turn", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    const completedAt = DateTime.makeUnsafe("2026-10-27T15:00:00.000Z");
    yield* insertGeneration(
      database,
      generation({ uncached: 1, output: 1, creation: 0, cached: 0 }),
    );
    yield* startTurn();
    yield* insertGeneration(
      database,
      generation({ uncached: 2_000, output: 300, creation: 500, cached: 117_500 }),
    );
    const [threadUpdate, settled] = yield* emit(
      {
        type: "provider_thread.updated",
        driver: ProviderDriverKind.make("antigravity"),
        providerThread: { ...providerThread, contextUsage },
      },
      turnEvent("provider-turn:1", "completed", completedAt),
    );
    assert.strictEqual(threadUpdate?.type, "provider_thread.updated");
    assert.deepStrictEqual(
      settled?.type === "provider_turn.updated" && settled.providerTurn.tokenUsage,
      {
        cacheScopeKey: "antigravity:gemini-3.1-pro-high",
        usedTokens: 120_000,
        maxTokens: 1_048_576,
        inputTokens: 120_000,
        cachedInputTokens: 117_500,
        cacheCreationTokens: 500,
        outputTokens: 300,
        reasoningOutputTokens: 0,
        updatedAt: "2026-10-27T15:00:00.000Z",
      },
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("leaves a turn that wrote no generation without usage", () =>
  Effect.gen(function* () {
    const { database, startTurn, emit } = yield* setup;
    yield* insertGeneration(
      database,
      generation({ uncached: 2_000, output: 300, creation: 500, cached: 117_500 }),
    );
    yield* startTurn();
    const [settled] = yield* emit(
      turnEvent("provider-turn:2", "interrupted", DateTime.makeUnsafe("2026-10-27T15:05:00Z")),
    );
    assert.isTrue(settled?.type === "provider_turn.updated");
    assert.isUndefined(
      settled?.type === "provider_turn.updated" && settled.providerTurn.tokenUsage,
    );
  }).pipe(Effect.scoped, Effect.provide(layer)),
);
