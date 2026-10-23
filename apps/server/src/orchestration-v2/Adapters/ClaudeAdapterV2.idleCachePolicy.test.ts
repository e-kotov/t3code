import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
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
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";

import * as ServerSettings from "../../serverSettings.ts";
const DEFAULT_CLAUDE_SETTINGS = Schema.decodeSync(ClaudeSettings)({});
const NATIVE_SESSION = "native-thread-claude-cache-ttl";
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make(ClaudeAdapterV2.CLAUDE_PROVIDER),
  model: "claude-sonnet-4-6",
} satisfies ModelSelection;
const RUNTIME_POLICY = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
});


it.effect.each(["warm", "off"] as const)("suppresses Claude’s resume prompt with a live per-thread %s override", (policy) => Effect.scoped(Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  let openedOptions: ClaudeAdapterV2.ClaudeAgentSdkQueryOptions | undefined;
  const adapter = yield* ClaudeAdapterV2.makeClaudeAdapterV2({
    instanceId: ClaudeAdapterV2.CLAUDE_DEFAULT_INSTANCE_ID,
    settings: DEFAULT_CLAUDE_SETTINGS, environment: {},
    attachmentsDir: yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-cache-policy-" }),
    fileSystem, path: yield* Path.Path, crypto: yield* Crypto.Crypto, idAllocator: yield* IdAllocator.IdAllocatorV2,
    queryRunner: {
      allocateSessionId: Effect.succeed(NATIVE_SESSION),
      open: (input) => Effect.sync(() => {
        openedOptions = input.options;
        return { messages: Stream.never, offer: () => Effect.void, setModel: () => Effect.void, applyFlagSettings: () => Effect.void,
          setPermissionMode: () => Effect.void, backgroundTasks: () => Effect.succeed(false), stopTask: () => Effect.void, interrupt: Effect.void, close: Effect.void };
      }),
      forkSession: () => Effect.die("unused"), subagentLaunchToolUseId: () => Effect.succeed(null), assertComplete: Effect.void,
    },
  });
  const threadId = ThreadId.make("thread-claude-idle-policy");
  const runtime = yield* adapter.openSession({ threadId, providerSessionId: ProviderSessionId.make("session-idle-policy"), modelSelection: MODEL_SELECTION, runtimePolicy: RUNTIME_POLICY });
  const providerThread = yield* runtime.ensureThread({ threadId, modelSelection: MODEL_SELECTION, runtimePolicy: RUNTIME_POLICY });
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

  const settings = yield* ServerSettings.ServerSettingsService;
  yield* settings.updateSettings({ threadCachePolicies: { [threadId]: policy } });
  const callback = openedOptions?.onUserDialog;
  assert.isDefined(callback);
  const result = yield* Effect.promise(() => callback!(
    { dialogKind: "resume_return", payload: { sessionAgeMinutes: 90, estimatedTokens: 250000 } },
    { signal: new AbortController().signal, requestId: "resume-with-thread-policy" },
  ));
  assert.deepEqual(result, { behavior: "completed", result: "continue" });
})).pipe(Effect.provide(Layer.mergeAll(IdAllocator.layer, McpProviderSessions.layer, NodeServices.layer, ServerSettings.layerTest({ idleCompaction: "beforeCacheExpires" })))));
