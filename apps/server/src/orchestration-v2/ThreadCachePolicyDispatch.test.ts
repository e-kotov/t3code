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
import {
  ProviderAdapterTurnStartError,
  ProviderCompactionUnsupportedError,
} from "@t3tools/provider-core/server/ProviderAdapter";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";

import { idleCompactionStartOutcome } from "./IdleCompactionOutcome.ts";
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
          cachedInputTokens: 120_000,
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

it("applies the selected provider delay and context cutoff to machine compaction", () => {
  for (const [driver, idleMinutes] of [
    ["claudeAgent", 55],
    ["codex", 115],
    ["antigravity", 55],
  ] as const) {
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      machineIdlePolicy: { mode: "compact", [driver]: { minContextTokens: 150_000 } },
    });
    const fixture = (usedTokens: number) => {
      const projection = records({
        usedTokens,
        ...(driver === "claudeAgent" ? { cacheExpiresInMs: 60 * MINUTE_MS } : {}),
      });
      projection.providerThreads = [
        { ...projection.providerThreads[0]!, driver: ProviderDriverKind.make(driver) },
      ];
      return projection;
    };
    const due = NOW_MS + idleMinutes * MINUTE_MS;
    const allowed = (usedTokens: number, now: number) =>
      backgroundCacheCommandAllowed(settings, fixture(usedTokens), compactCommand(), now);
    expect(allowed(150_000, due - 1)).toBe(false);
    expect(allowed(149_999, due)).toBe(false);
    expect(allowed(150_000, due)).toBe(true);
    expect(allowed(150_000, due + 5 * MINUTE_MS)).toBe(false);
  }
});

it("blocks stale machine warm commands and compaction after a synthetic warm turn", () => {
  const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
    machineIdlePolicy: { mode: "warm" },
  });
  const projection = records({ cacheExpiresInMs: 60 * MINUTE_MS });
  const due = NOW_MS + 55 * MINUTE_MS;
  const command = {
    ...compactCommand(),
    commandId: CommandId.make(`command:cache-warm:machine:${threadId}:${runId}:${due}`),
  };
  expect(backgroundCacheCommandAllowed(settings, projection, command, due - 1)).toBe(false);
  expect(backgroundCacheCommandAllowed(settings, projection, command, due)).toBe(true);
  const expired = records();
  const latestTurn = expired.providerTurns[0]!;
  expired.providerTurns = [
    {
      ...latestTurn,
      id: ProviderTurnId.make("earlier-cache-write"),
      tokenUsage: {
        ...latestTurn.tokenUsage!,
        updatedAt: DateTime.formatIso(at(-MINUTE_MS)),
        promptCacheTtlMs: 5 * MINUTE_MS,
      },
    },
    { ...latestTurn, ordinal: 2 },
  ];
  expect(backgroundCacheCommandAllowed(settings, expired, command, due)).toBe(false);
  const afterManual = {
    ...projection,
    messages: [{ ...projection.messages[0]!, text: "/compact" }],
  };
  expect(backgroundCacheCommandAllowed(settings, afterManual, command, due)).toBe(false);
  const off = applyServerSettingsPatch(settings, { machineIdlePolicy: { mode: "off" } });
  expect(backgroundCacheCommandAllowed(off, projection, command, due)).toBe(false);
  const afterWarm = {
    ...projection,
    messages: [{ ...projection.messages[0]!, createdBy: "system" as const }],
  };
  expect(backgroundCacheCommandAllowed(settings, afterWarm, command, due)).toBe(false);
  const compact = applyServerSettingsPatch(settings, { machineIdlePolicy: { mode: "compact" } });
  expect(backgroundCacheCommandAllowed(compact, afterWarm, compactCommand(), due)).toBe(false);
});

it("skips unsupported automatic compaction without suppressing manual compaction errors", () => {
  const driver = ProviderDriverKind.make("antigravity");
  const cause = new ProviderAdapterTurnStartError({
    driver,
    threadId,
    providerThreadId,
    runId,
    cause: new ProviderCompactionUnsupportedError({ driver, providerThreadId }),
  });
  const terminal = {
    type: "turn.terminal",
    driver,
    providerThreadId,
    providerTurnId: ProviderTurnId.make("unsupported-compaction"),
    runOrdinal: 2,
    failureItemOrdinal: 1,
    status: "failed",
    failure: makeProviderFailure({ cause, class: "provider_error" }),
    threadDisposition: "reusable",
  } as const;
  const message = {
    messageId: MessageId.make(`idle-compact:${threadId}:${runId}`),
    text: "/compact",
    attachments: [],
    createdBy: "agent",
    creationSource: "server",
  } as const;
  expect(idleCompactionStartOutcome(message, cause, terminal)).toMatchObject({
    status: "cancelled",
    failure: null,
  });
  expect(idleCompactionStartOutcome(message, new Error("transient"), terminal)).toBe(terminal);
  expect(
    idleCompactionStartOutcome(
      { ...message, createdBy: "user", creationSource: "web" },
      cause,
      terminal,
    ),
  ).toBe(terminal);
});
