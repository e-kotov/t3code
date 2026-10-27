import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderTurnTokenUsage,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSetupError,
} from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as EffectAcpErrors from "effect-acp/errors";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type { AntigravityAuth } from "../../provider/AntigravityAuth.ts";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { resolveAntigravityInstanceDirectories } from "../../provider/antigravityAuthSupport.ts";
import {
  makeAntigravityUsageCache,
  readAntigravityUsage,
} from "../../provider/Drivers/antigravityUsageReader.ts";
import {
  antigravityPermissionMode,
  applyAntigravityAcpModelSelection,
  buildAntigravityPrompt,
  type AntigravityAcpRuntimeInput,
} from "../../provider/acp/AntigravityAcpSupport.ts";
import {
  readAntigravityClientTextFile,
  writeAntigravityClientTextFile,
} from "../../provider/acp/AntigravityClientFiles.ts";
import {
  antigravityApprovalOptions,
  antigravitySubagentOutput,
  classifyAntigravitySubagentToolCall,
  extractAntigravityUserInputQuestion,
  makeAntigravityUserInputResponse,
  normalizeAntigravityToolCall,
} from "../../provider/acp/AntigravityProtocol.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";

const ANTIGRAVITY_PROVIDER = ProviderDriverKind.make("antigravity");

const AntigravityProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
    supportsRuntimeModeSwitchInSession: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface AntigravityAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly selfInvocation: SelfInvocation;
  readonly makeRuntime: (
    input: Omit<AntigravityAcpRuntimeInput, "spawn" | "childProcessSpawner">,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError | ProviderSetupError,
    Scope.Scope
  >;
  readonly withProcess: AntigravityAuth["withProcess"];
  readonly defaultModel: Effect.Effect<string | undefined>;
  readonly onSessionStarted?: (
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onSessionEvent?: AcpAdapterV2Flavor["onSessionEvent"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
}

/** ACP 1.1.1 reports `start_subagent` tools without child session ids. */
const extractAntigravitySubagentUpdate: NonNullable<AcpAdapterV2Flavor["extractSubagentUpdate"]> = (
  toolCall,
) => {
  if (classifyAntigravitySubagentToolCall(toolCall) !== "subagent") {
    return undefined;
  }
  const status =
    toolCall.status === "failed" ? "failed" : toolCall.status === "pending" ? "pending" : "running";
  return {
    nativeTaskId: toolCall.toolCallId,
    prompt:
      antigravitySubagentOutput(toolCall) ??
      toolCall.detail ??
      toolCall.title ??
      "Antigravity subagent batch",
    title: "Antigravity subagent batch",
    model: null,
    status,
    childSessionId: null,
    result: status === "failed" ? (antigravitySubagentOutput(toolCall) ?? null) : null,
  };
};

interface AntigravityFlavorServices {
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly host: ProviderHost.ProviderHost["Service"];
}

export function makeAntigravityAcpAdapterFlavor(
  options: AntigravityAdapterV2Options & AntigravityFlavorServices,
): AcpAdapterV2Flavor {
  const antigravityClientFileRoots = (cwd: string | null) =>
    cwd === null ? [options.host.paths.attachmentsDir] : [cwd, options.host.paths.attachmentsDir];
  const makeRuntime = Effect.fn("AntigravityAdapterV2.makeRuntime")(
    function* (input: AcpAdapterV2RuntimeInput) {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const runtime = yield* options
        .withProcess(
          Scope.close(scope, Exit.void),
          options.makeRuntime({
            ...input,
            clientFileSystem: true,
            additionalDirectories: [options.host.paths.attachmentsDir],
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));
      return {
        ...runtime,
        start: () =>
          runtime
            .start()
            .pipe(
              Effect.tap(
                (started) => options.onSessionStarted?.(started, input.cwd) ?? Effect.void,
              ),
            ),
      };
    },
    Effect.provideService(Crypto.Crypto, options.crypto),
    Effect.mapError((cause): EffectAcpErrors.AcpError =>
      cause._tag === "ProviderSetupError"
        ? new EffectAcpErrors.AcpTransportError({ detail: cause.detail, cause })
        : cause,
    ),
  );

  return {
    driver: ANTIGRAVITY_PROVIDER,
    runtimeHarness: "Antigravity",
    capabilities: AntigravityProviderCapabilitiesV2,
    makeRuntime,
    buildPrompt: ({ text, attachments, promptCapabilities }) =>
      buildAntigravityPrompt({
        input: text,
        attachments,
        attachmentsDir: options.host.paths.attachmentsDir,
        promptCapabilities,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, options.fileSystem),
        Effect.provideService(Path.Path, options.path),
      ),
    // Loading history replays tool calls; resume avoids replay.
    preferResumeSession: true,
    subagentsIdleOnTurnCompletion: true,
    ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
    applyModelSelection: Effect.fn("AntigravityAdapterV2.applyModelSelection")(function* ({
      runtime,
      modelSelection,
    }) {
      const defaultModel = yield* options.defaultModel;
      return yield* applyAntigravityAcpModelSelection({
        runtime,
        model:
          modelSelection.model === ANTIGRAVITY_DEFAULT_MODEL ? undefined : modelSelection.model,
        defaultModel,
        mapError: (cause) => cause,
      });
    }),
    sessionModeForPolicy: (policy) => antigravityPermissionMode(policy.runtimeMode),
    clientFileSystem: {
      readTextFile: (request, cwd) =>
        readAntigravityClientTextFile({
          fileSystem: options.fileSystem,
          path: options.path,
          allowedRoots: antigravityClientFileRoots(cwd),
          request,
        }),
      writeTextFile: (request, cwd) =>
        writeAntigravityClientTextFile({
          fileSystem: options.fileSystem,
          path: options.path,
          allowedRoots: antigravityClientFileRoots(cwd),
          request,
        }),
    },
    approvalOptions: antigravityApprovalOptions,
    extractPermissionQuestion: (request) => {
      const question = extractAntigravityUserInputQuestion(request);
      if (question === undefined) return undefined;
      return {
        question,
        respond: (answers) => makeAntigravityUserInputResponse(request, answers),
      };
    },
    normalizeToolCall: normalizeAntigravityToolCall,
    extractSubagentUpdate: extractAntigravitySubagentUpdate,
    supportsImagePrompts: true,
    supportsCompaction: true,
  };
}

export const makeAntigravityAdapterV2 = Effect.fn("makeAntigravityAdapterV2")(function* (
  options: AntigravityAdapterV2Options,
) {
  const services: AntigravityFlavorServices = {
    crypto: yield* Crypto.Crypto,
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    host: yield* ProviderHost.ProviderHost,
  };
  const baseAdapter = yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeAntigravityAcpAdapterFlavor({ ...options, ...services }),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });

  const usageCache = makeAntigravityUsageCache();
  const getConversationRoots = Effect.fn("AntigravityAdapterV2.getConversationRoots")(function* () {
    const dirs = yield* resolveAntigravityInstanceDirectories(
      services.host.paths.stateDir,
      options.instanceId,
    ).pipe(
      Effect.provideService(Crypto.Crypto, services.crypto),
      Effect.provideService(Path.Path, services.path),
      Effect.option,
    );
    const home = yield* HostProcess.HomeDirectory.pipe(Effect.option);
    const roots: string[] = [];
    if (dirs._tag === "Some") {
      roots.push(services.path.join(dirs.value.profile, "antigravity-acp", "conversations"));
      roots.push(services.path.join(dirs.value.profile, "conversations"));
    }
    if (home._tag === "Some") {
      roots.push(
        services.path.join(home.value, ".gemini", "antigravity-cli", "conversations"),
        services.path.join(home.value, ".gemini", "antigravity", "conversations"),
        services.path.join(
          home.value,
          "Library",
          "Application Support",
          "Antigravity",
          "User",
          "globalStorage",
          "google.antigravity",
          "conversations",
        ),
        services.path.join(
          home.value,
          ".config",
          "Antigravity",
          "User",
          "globalStorage",
          "google.antigravity",
          "conversations",
        ),
      );
    }
    const existing: string[] = [];
    for (const root of roots) {
      const exists = yield* services.fileSystem.exists(root).pipe(Effect.orElseSucceed(() => false));
      if (exists) existing.push(root);
    }
    return existing;
  });

  const enrichTurnWithUsage = (
    event: ProviderAdapter.ProviderAdapterV2Event & {
      readonly type: "provider_turn.updated";
    },
    nativeSessionId: string | undefined,
  ) =>
    Effect.gen(function* () {
      if (!nativeSessionId) return event;
      const roots = yield* getConversationRoots();
      if (roots.length === 0) return event;
      const scan = yield* readAntigravityUsage(roots, 0, usageCache).pipe(
        Effect.provideService(FileSystem.FileSystem, services.fileSystem),
        Effect.provideService(Path.Path, services.path),
        Effect.option,
      );
      if (scan._tag === "None") return event;
      const records = scan.value.files
        .flatMap((file) => file.records)
        .filter((rec) => rec.sessionId === nativeSessionId);
      const latest = records[records.length - 1];
      if (!latest) return event;
      const totals = latest.totals;
      const inputTokens = totals.uncachedInputTokens + totals.cachedInputTokens;
      const usedTokens = inputTokens + totals.outputTokens;
      const now = yield* DateTime.now;
      const tokenUsage: OrchestrationV2ProviderTurnTokenUsage = {
        usedTokens,
        inputTokens,
        cachedInputTokens: totals.cachedInputTokens,
        cacheCreationTokens: totals.cacheCreationTokens,
        outputTokens: totals.outputTokens,
        reasoningOutputTokens: totals.reasoningTokens,
        updatedAt: DateTime.formatIso(now),
      };
      return {
        ...event,
        providerTurn: {
          ...event.providerTurn,
          tokenUsage,
        },
      };
    });

  return {
    ...baseAdapter,
    openSession: (input: ProviderAdapter.ProviderAdapterV2OpenSessionInput) =>
      Effect.gen(function* () {
        const threadNativeIds = new Map<string, string>();
        if (input.initialNativeThreadId) {
          threadNativeIds.set(input.threadId, input.initialNativeThreadId);
        }
        const sessionRuntime = yield* baseAdapter.openSession({
          ...input,
          subscribeEvents: (subscription: ProviderAdapter.ProviderAdapterV2EventSubscription) => {
            const enrichedEvents = subscription.events.pipe(
              Stream.mapEffect((event) =>
                Effect.gen(function* () {
                  if (event.type === "provider_thread.updated") {
                    const nativeId = event.providerThread.nativeThreadRef?.nativeId;
                    if (nativeId) {
                      threadNativeIds.set(event.providerThread.id, nativeId);
                    }
                  }
                  if (
                    event.type === "provider_turn.updated" &&
                    event.providerTurn.tokenUsage === undefined &&
                    (event.providerTurn.status === "completed" ||
                      event.providerTurn.status === "interrupted" ||
                      event.providerTurn.status === "failed")
                  ) {
                    const nativeId =
                      threadNativeIds.get(event.providerTurn.providerThreadId) ??
                      event.providerTurn.nativeTurnRef?.nativeId;
                    return yield* enrichTurnWithUsage(event, nativeId);
                  }
                  return event;
                }),
              ),
            );
            return yield* input.subscribeEvents({
              ...subscription,
              events: enrichedEvents,
            });
          },
        });

        return {
          ...sessionRuntime,
          ensureThread: (threadInput) =>
            Effect.gen(function* () {
              const thread = yield* sessionRuntime.ensureThread(threadInput);
              if (thread.nativeThreadRef?.nativeId) {
                threadNativeIds.set(thread.id, thread.nativeThreadRef.nativeId);
              }
              return thread;
            }),
          resumeThread: (threadInput) =>
            Effect.gen(function* () {
              const thread = yield* sessionRuntime.resumeThread(threadInput);
              if (thread.nativeThreadRef?.nativeId) {
                threadNativeIds.set(thread.id, thread.nativeThreadRef.nativeId);
              }
              return thread;
            }),
          startTurn: (turnInput) =>
            Effect.gen(function* () {
              if (turnInput.providerThread.nativeThreadRef?.nativeId) {
                threadNativeIds.set(
                  turnInput.providerThread.id,
                  turnInput.providerThread.nativeThreadRef.nativeId,
                );
              }
              return yield* sessionRuntime.startTurn(turnInput);
            }),
        };
      }),
  };
});
