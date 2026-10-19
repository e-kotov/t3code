import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClaudeSettings,
  MessageId,
  type ModelSelection,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";

const DEFAULT_CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const NATIVE_SESSION = "native-thread-claude-cache-ttl";
const HOUR_MS = 60 * 60_000;
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-sonnet-4-6",
} satisfies ModelSelection;
const RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});

const sdkFrame = (frame: unknown) => frame as SDKMessage;
const assistantSnapshot = (id: string, usage: unknown) =>
  sdkFrame({
    type: "assistant",
    message: {
      model: MODEL_SELECTION.model,
      id,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Working." }],
      stop_reason: null,
      stop_sequence: null,
      usage,
    },
    parent_tool_use_id: null,
    uuid: `uuid-${id}`,
    session_id: NATIVE_SESSION,
  });
const resultFrame = sdkFrame({
  type: "result",
  subtype: "success",
  duration_ms: 10,
  duration_api_ms: 10,
  is_error: false,
  num_turns: 1,
  result: "Done.",
  stop_reason: "end_turn",
  total_cost_usd: 0,
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  modelUsage: {},
  permission_denials: [],
  uuid: "uuid-result",
  session_id: NATIVE_SESSION,
  terminal_reason: "completed",
});

const cacheWrite1h = {
  input_tokens: 5,
  output_tokens: 3,
  cache_creation_input_tokens: 2_000,
  cache_read_input_tokens: 0,
  cache_creation: { ephemeral_1h_input_tokens: 2_000, ephemeral_5m_input_tokens: 0 },
};
const cacheReadOnly = {
  input_tokens: 5,
  output_tokens: 4,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 2_000,
};
const uncached = {
  input_tokens: 7,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

// Runs one turn on a single live query and returns each reported context
// measurement (keyed by its distinct usedTokens) with the TTL it carried.
const reportedTtls = (frames: ReadonlyArray<SDKMessage>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const sdkMessages = yield* Queue.unbounded<SDKMessage>();
    const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
      instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
      settings: DEFAULT_CLAUDE_SETTINGS,
      environment: {},
      attachmentsDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-cache-ttl-" }),
      fileSystem,
      path: yield* Path.Path,
      crypto: yield* Crypto.Crypto,
      idAllocator: yield* IdAllocator.IdAllocatorV2,
      queryRunner: {
        allocateSessionId: Effect.succeed(NATIVE_SESSION),
        open: () =>
          Effect.succeed({
            messages: Stream.fromQueue(sdkMessages),
            offer: () => Effect.void,
            setModel: () => Effect.void,
            applyFlagSettings: () => Effect.void,
            setPermissionMode: () => Effect.void,
            backgroundTasks: () => Effect.succeed(false),
            stopTask: () => Effect.void,
            interrupt: Effect.void,
            close: Effect.void,
          }),
        forkSession: () => Effect.die("unused forkSession"),
        subagentLaunchToolUseId: () => Effect.succeed(null),
        assertComplete: Effect.void,
      },
    });
    const threadId = ThreadId.make("thread-claude-cache-ttl");
    const runtime = yield* adapter.openSession({
      threadId,
      providerSessionId: ProviderSessionId.make("provider-session-claude-cache-ttl"),
      modelSelection: MODEL_SELECTION,
      runtimePolicy: RUNTIME_POLICY,
    });
    const providerThread = yield* runtime.ensureThread({
      threadId,
      modelSelection: MODEL_SELECTION,
      runtimePolicy: RUNTIME_POLICY,
    });
    const ttls = new Map<number, number | undefined>();
    const terminal = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
    yield* runtime.events.pipe(
      Stream.runForEach((event) => {
        if (event.type === "provider_turn.updated" && event.providerTurn.tokenUsage) {
          const usage = event.providerTurn.tokenUsage;
          ttls.set(usage.usedTokens, usage.promptCacheTtlMs);
        }
        return event.type === "turn.terminal" ? Queue.offer(terminal, event) : Effect.void;
      }),
      Effect.forkScoped,
    );
    const now = yield* DateTime.now;
    const attemptId = RunAttemptId.make("attempt-claude-cache-ttl");
    yield* runtime.startTurn({
      appThread: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project-claude-cache-ttl"),
        title: "Claude cache TTL",
        providerInstanceId: MODEL_SELECTION.instanceId,
        modelSelection: MODEL_SELECTION,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
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
      threadId,
      runId: RunId.make(`run-${attemptId}`),
      runOrdinal: 1,
      providerTurnOrdinal: 1,
      attemptId,
      rootNodeId: NodeId.make(`node-${attemptId}`),
      providerThread,
      message: {
        createdBy: "user",
        creationSource: "web",
        messageId: MessageId.make(`message-${attemptId}`),
        text: "Continue.",
        attachments: [],
      },
      modelSelection: MODEL_SELECTION,
      runtimePolicy: RUNTIME_POLICY,
    });
    for (const frame of [...frames, resultFrame]) yield* Queue.offer(sdkMessages, frame);
    yield* Queue.take(terminal);
    return ttls;
  });
const adapterLayer = Layer.mergeAll(
  IdAllocator.layer,
  McpProviderSessions.layer,
  NodeServices.layer,
);

describe("ClaudeAdapterV2 prompt cache TTL", () => {
  it.effect("carries a written TTL to later cache reads in the same live query", () =>
    Effect.gen(function* () {
      const ttls = yield* reportedTtls([
        assistantSnapshot("msg_write", cacheWrite1h),
        assistantSnapshot("msg_read", cacheReadOnly),
        assistantSnapshot("msg_uncached", uncached),
      ]);
      assert.strictEqual(ttls.get(2_008), HOUR_MS);
      assert.strictEqual(ttls.get(2_009), HOUR_MS);
      // A request that read nothing from the cache does not refresh it.
      assert.isTrue(ttls.has(8));
      assert.strictEqual(ttls.get(8), undefined);
    }).pipe(Effect.provide(adapterLayer)),
  );

  it.effect("reports no TTL for a cache read before this live query wrote one", () =>
    Effect.gen(function* () {
      const ttls = yield* reportedTtls([assistantSnapshot("msg_read", cacheReadOnly)]);
      assert.isTrue(ttls.has(2_009));
      assert.strictEqual(ttls.get(2_009), undefined);
    }).pipe(Effect.provide(adapterLayer)),
  );
});
