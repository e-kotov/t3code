import { assert, it } from "@effect/vitest";
import {
  EventId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2CacheHud,
  type OrchestrationV2ProviderTurnTokenUsage,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const driver = ProviderDriverKind.make("claudeAgent");
const sonnet = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-sonnet-4-6",
} satisfies ModelSelection;
const opus = { ...sonnet, model: "claude-opus-4-6" } satisfies ModelSelection;
const scopeOf = (selection: ModelSelection) => `${selection.instanceId}:${selection.model}`;
const HOUR_MS = 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;
// Report time rises with the ordinal: SQL bounds by ordinal, derivation by time.
const reportedAt = (ordinal: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(Date.UTC(2026, 9, 19, 9, 0, 0) + ordinal * 1_000));

const cacheRead = (
  ordinal: number,
  selection: ModelSelection,
): OrchestrationV2ProviderTurnTokenUsage => ({
  usedTokens: 10_000 + ordinal,
  inputTokens: 10_000 + ordinal,
  cachedInputTokens: 9_000,
  cacheCreationTokens: 0,
  cacheScopeKey: scopeOf(selection),
  updatedAt: reportedAt(ordinal),
});
const cacheWrite = (
  ordinal: number,
  selection: ModelSelection,
  promptCacheTtlMs: number,
): OrchestrationV2ProviderTurnTokenUsage => ({
  usedTokens: 10_000 + ordinal,
  inputTokens: 10_000 + ordinal,
  cachedInputTokens: 0,
  cacheCreationTokens: 8_000,
  cacheScopeKey: scopeOf(selection),
  promptCacheTtlMs,
  updatedAt: reportedAt(ordinal),
});

const layerSql = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

it.effect.each([
  ["memory", ProjectionStore.layerMemory],
  ["SQL", layerSql],
] as const)(
  "%s shells derive the cache HUD from the active provider thread's recent reports",
  ([, layer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:cache-hud");
      const nodeId = NodeId.make("node:cache-hud");
      let eventCount = 0;
      const nextEventId = () => EventId.make(`event:cache-hud:${++eventCount}`);

      const assertCacheHud = Effect.fnUntraced(function* (
        expected: OrchestrationV2CacheHud | null,
      ) {
        const listed = (yield* store.getShellSnapshot()).threads.find(
          (thread) => thread.id === threadId,
        );
        assert.deepEqual((yield* store.getThreadShell(threadId))?.cacheHud, expected);
        assert.deepEqual(listed?.cacheHud, expected);
      });
      const activateProviderThread = (
        providerThreadId: ProviderThreadId,
        providerDriver = driver,
        selection = sonnet,
      ) =>
        store.apply({
          id: nextEventId(),
          type: "provider-thread.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver: providerDriver,
            providerInstanceId: selection.instanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            pendingBackgroundTasks: [],
          },
        });
      const reportUsage = (
        providerThreadId: ProviderThreadId,
        ordinal: number,
        tokenUsage: OrchestrationV2ProviderTurnTokenUsage,
        providerDriver = driver,
      ) =>
        store.apply({
          id: nextEventId(),
          type: "provider-turn.updated",
          threadId,
          nodeId,
          driver: providerDriver,
          occurredAt: now,
          payload: {
            id: ProviderTurnId.make(`${providerThreadId}:turn:${ordinal}`),
            providerThreadId,
            nodeId,
            runAttemptId: null,
            nativeTurnRef: null,
            ordinal,
            status: "completed",
            startedAt: now,
            completedAt: now,
            tokenUsage,
          },
        });

      yield* store.apply({
        id: nextEventId(),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:cache-hud"),
          title: "Cache HUD",
          providerInstanceId: sonnet.instanceId,
          modelSelection: sonnet,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
      yield* assertCacheHud(null);

      // A provider thread without usage has no clock yet.
      const first = ProviderThreadId.make("provider-thread:cache-hud:first");
      yield* activateProviderThread(first);
      yield* assertCacheHud(null);
      const written = cacheWrite(1, sonnet, HOUR_MS);
      yield* reportUsage(first, 1, written);
      yield* assertCacheHud({ driver, usage: written, ttlMs: HOUR_MS, basis: "reported" });

      // A newly active provider thread never shows the previous thread's clock or TTL.
      const second = ProviderThreadId.make("provider-thread:cache-hud:second");
      yield* activateProviderThread(second);
      yield* assertCacheHud(null);
      const read = cacheRead(1, sonnet);
      yield* reportUsage(second, 1, read);
      yield* assertCacheHud({ driver, usage: read, basis: "unknown" });

      // Reports scoped to the previous model stop counting after a model change.
      const thread = (yield* store.getThreadProjection(threadId)).thread;
      yield* store.apply({
        id: nextEventId(),
        type: "thread.model-selection-updated",
        threadId,
        occurredAt: now,
        payload: { ...thread, modelSelection: opus },
      });
      yield* assertCacheHud(null);
      const opusRead = cacheRead(2, opus);
      yield* reportUsage(second, 2, opusRead);
      yield* assertCacheHud({ driver, usage: opusRead, basis: "unknown" });

      // Only the 64 most recent reports count: a TTL survives 63 later reads, not 64.
      yield* reportUsage(second, 3, cacheWrite(3, opus, FIVE_MINUTES_MS));
      for (let ordinal = 4; ordinal <= 66; ordinal++) {
        yield* reportUsage(second, ordinal, cacheRead(ordinal, opus));
      }
      yield* assertCacheHud({
        driver,
        usage: cacheRead(66, opus),
        ttlMs: FIVE_MINUTES_MS,
        basis: "reported",
      });
      yield* reportUsage(second, 67, cacheRead(67, opus));
      yield* assertCacheHud({ driver, usage: cacheRead(67, opus), basis: "unknown" });

      const codex = ProviderDriverKind.make("codex");
      const codexSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
      const codexThread = ProviderThreadId.make("provider-thread:cache-hud:codex");
      yield* store.apply({
        id: nextEventId(), type: "thread.model-selection-updated", threadId, occurredAt: now,
        payload: { ...thread, modelSelection: codexSelection },
      });
      yield* activateProviderThread(codexThread, codex, codexSelection);
      const previousRequest = { ...cacheRead(1, codexSelection), updatedAt: "2026-10-21T09:00:00.000Z" };
      yield* reportUsage(codexThread, 1, previousRequest, codex);
      const firstRequest = {
        startedAt: "2026-10-21T09:47:00.000Z", reportedAt: "2026-10-21T09:48:00.000Z",
        inputTokens: 10_000, cachedInputTokens: 0,
      };
      const latestRequest = {
        ...cacheRead(2, codexSelection), updatedAt: "2026-10-21T09:50:00.000Z",
        cacheFirstRequest: firstRequest,
      };
      yield* reportUsage(codexThread, 2, latestRequest, codex);
      yield* assertCacheHud({
        driver: codex, usage: latestRequest, ttlMs: 30 * 60_000, basis: "estimated",
        resumeObservation: { ...firstRequest, gapMs: 47 * 60_000 },
      });
      // Completion events omit usage; both persistence paths must retain the first-response evidence.
      const turn = (yield* store.getThreadProjection(threadId)).providerTurns.find(
        (entry) => entry.providerThreadId === codexThread && entry.ordinal === 2,
      )!;
      const { tokenUsage: _usage, ...withoutUsage } = turn;
      yield* store.apply({
        id: nextEventId(), type: "provider-turn.updated", threadId, nodeId,
        driver: codex, occurredAt: now, payload: withoutUsage,
      });
      yield* assertCacheHud({
        driver: codex, usage: latestRequest, ttlMs: 30 * 60_000, basis: "estimated",
        resumeObservation: { ...firstRequest, gapMs: 47 * 60_000 },
      });
    }).pipe(Effect.provide(layer)),
);
