import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2Command,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { type IdleCompactionRecords } from "./IdleCompaction.ts";

import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import {
  backgroundCacheCommandAllowed,
  isBackgroundCacheCommand,
} from "./ThreadCachePolicyDispatch.ts";

const NOW_MS = Date.parse("2026-10-19T12:00:00.000Z");
const MINUTE_MS = 60_000;
const at = (offset = 0) => DateTime.makeUnsafe(NOW_MS + offset);
const threadId = ThreadId.make("idle-thread");
const runId = RunId.make("run-1");
const instanceId = ProviderInstanceId.make("claudeAgent");
const providerThreadId = ProviderThreadId.make("provider-thread");
const modelSelection = { instanceId, model: "claude-opus-5-5" };

function records(
  usage: { readonly usedTokens?: number; readonly cacheExpiresInMs?: number } = {},
): { -readonly [Key in keyof IdleCompactionRecords]: IdleCompactionRecords[Key] } {
  const messageId = MessageId.make("message-1");
  const nodeId = NodeId.make("root-node");
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("project"),
      title: "Idle thread",
      createdBy: "user",
      creationSource: "web",
      providerInstanceId: instanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: providerThreadId,
      lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
      forkedFrom: null,
      createdAt: at(-MINUTE_MS),
      updatedAt: at(),
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: at(),
      deletedAt: null,
    },
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId: instanceId,
        modelSelection,
        providerThreadId,
        userMessageId: messageId,
        rootNodeId: nodeId,
        activeAttemptId: null,
        status: "completed",
        requestedAt: at(-MINUTE_MS),
        startedAt: at(-MINUTE_MS),
        completedAt: at(),
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    messages: [
      {
        id: messageId,
        threadId,
        runId,
        nodeId,
        role: "user",
        text: "Explain this code",
        attachments: [],
        streaming: false,
        createdBy: "user",
        creationSource: "web",
        createdAt: at(-MINUTE_MS),
        updatedAt: at(-MINUTE_MS),
      },
    ],
    providerThreads: [
      {
        id: providerThreadId,
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: instanceId,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: nodeId,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: at(-MINUTE_MS),
        updatedAt: at(),
      },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make("provider-turn-1"),
        providerThreadId,
        nodeId,
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal: 1,
        status: "completed",
        startedAt: at(-MINUTE_MS),
        completedAt: at(),
        tokenUsage: {
          usedTokens: usage.usedTokens ?? 250_000,
          ...(usage.cacheExpiresInMs === undefined
            ? {}
            : { promptCacheExpiresAt: DateTime.formatIso(at(usage.cacheExpiresInMs)) }),
          updatedAt: DateTime.formatIso(at()),
        },
      },
    ],
    runtimeRequests: [],
    turnItems: [],
    contextTransfers: [],
  };
}

function compactCommand(): Extract<OrchestrationV2Command, { type: "message.dispatch" }> {
  return {
    type: "message.dispatch",
    commandId: CommandId.make(`server:idle-compact:${threadId}:${runId}`),
    threadId,
    messageId: MessageId.make("compact"),
    text: "/compact",
    attachments: [],
    createdBy: "agent",
    creationSource: "server",
    dispatchMode: { type: "start_immediately" },
  };
}

it("rejects an already armed compaction after switching to Warm or Off, and accepts it when Compact overrides global Off", () => {
  const projection = records({ cacheExpiresInMs: MINUTE_MS });
  const command = compactCommand();
  for (const [policy, allowed] of [
    ["default", false],
    ["warm", false],
    ["compact", true],
    ["off", false],
  ] as const) {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      idleCompaction: "off",
      threadCachePolicies: { [threadId]: policy },
    });
    expect(backgroundCacheCommandAllowed(settings, projection, command, NOW_MS)).toBe(allowed);
  }
});

it("rejects stale compaction windows, pending user messages, settled or snoozed threads and different providers", () => {
  const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    threadCachePolicies: { [threadId]: "compact" },
  });
  const command = compactCommand();
  const projection = records({ cacheExpiresInMs: MINUTE_MS });
  expect(backgroundCacheCommandAllowed(settings, projection, command, NOW_MS)).toBe(true);
  expect(backgroundCacheCommandAllowed(settings, projection, command, NOW_MS + 2 * MINUTE_MS)).toBe(
    false,
  );
  expect(
    backgroundCacheCommandAllowed(
      settings,
      records({ cacheExpiresInMs: 10 * MINUTE_MS }),
      command,
      NOW_MS,
    ),
  ).toBe(false);
  for (const changed of [
    {
      ...projection,
      runs: [...projection.runs, { ...projection.runs[0]!, status: "queued" as const, ordinal: 2 }],
    },
    { ...projection, thread: { ...projection.thread, settledOverride: "settled" as const } },
    { ...projection, thread: { ...projection.thread, snoozedUntil: at(MINUTE_MS) } },
    {
      ...projection,
      providerThreads: [
        { ...projection.providerThreads[0]!, driver: ProviderDriverKind.make("codex") },
      ],
    },
  ])
    expect(backgroundCacheCommandAllowed(settings, changed, command, NOW_MS)).toBe(false);
});

it("blocks a warm action queued before a policy change, while leaving ordinary user messages alone", () => {
  const projection = records({ cacheExpiresInMs: MINUTE_MS });
  const command = {
    ...compactCommand(),
    commandId: CommandId.make(`command:cache-warm:${threadId}:window`),
  };
  expect(isBackgroundCacheCommand(command)).toBe(true);
  for (const policy of ["default", "warm", "compact", "off"] as const) {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      threadCachePolicies: { [threadId]: policy },
    });
    expect(backgroundCacheCommandAllowed(settings, projection, command, NOW_MS)).toBe(
      policy === "warm",
    );
  }
  expect(
    isBackgroundCacheCommand({
      ...command,
      commandId: CommandId.make("manual:compact"),
      creationSource: "web",
    }),
  ).toBe(false);
});
