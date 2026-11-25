import {
  type ModelSelection,
  OrchestratorMcpFailure,
  type OrchestratorMcpScheduleTaskInput,
  type Project,
  resolveProjectProviderInstanceEnabled,
  type RuntimeMode,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolveRuntimeMode } from "./delegatedTaskModes.ts";

type ScheduledTaskTarget = NonNullable<OrchestratorMcpScheduleTaskInput["target"]>;

export interface ModelTargetParent {
  readonly thread: {
    readonly projectId: Project["id"];
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
  };
}

export const scheduledTaskExecutionResolver = (
  loadProviders: Effect.Effect<ReadonlyArray<ServerProvider>>,
  resolveTarget: (input: {
    readonly parent: ModelTargetParent;
    readonly target: ScheduledTaskTarget;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly cwd: string;
  }) => Effect.Effect<
    {
      readonly modelSelection: ModelSelection;
      readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
    },
    OrchestratorMcpFailure
  >,
) =>
  Effect.fn("resolveScheduledTaskExecution")(function* (config: {
    readonly input: Pick<OrchestratorMcpScheduleTaskInput, "target" | "freshSession">;
    readonly bindToCurrentThread: boolean;
    readonly runtimeMode: RuntimeMode;
    readonly inherited: ModelSelection | undefined;
    readonly projectDefault: Effect.Effect<ModelSelection, OrchestratorMcpFailure>;
    readonly project: Pick<Project, "id" | "workspaceRoot">;
    readonly settings: ServerSettings;
  }) {
    const { target, freshSession } = config.input;
    if (target === undefined) {
      return {
        modelSelection: config.inherited ?? (yield* config.projectDefault),
        runtimeMode: config.runtimeMode,
      };
    }
    if (config.bindToCurrentThread || freshSession) {
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message:
          "A scheduled model override needs a new thread per run. Set bindToCurrentThread to false and omit freshSession.",
      });
    }
    const { id: projectId, workspaceRoot: cwd } = config.project;
    if (
      !resolveProjectProviderInstanceEnabled(config.settings, projectId, target.providerInstanceId)
    ) {
      return yield* new OrchestratorMcpFailure({
        code: "provider_unavailable",
        message: `Provider ${target.providerInstanceId} is disabled for this project.`,
      });
    }
    const modelSelection = config.inherited ?? {
      instanceId: target.providerInstanceId,
      model: target.model,
    };
    const resolved = yield* resolveTarget({
      parent: { thread: { projectId, modelSelection, runtimeMode: config.runtimeMode } },
      target,
      providers: yield* loadProviders,
      cwd,
    });
    return {
      modelSelection: resolved.modelSelection,
      runtimeMode: yield* resolveRuntimeMode(config.runtimeMode, undefined, resolved),
    };
  });

export const rejectScheduledTaskModelUpdate = (target: ScheduledTaskTarget | undefined) =>
  target === undefined
    ? Effect.void
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The target model can only be set when creating a scheduled task.",
        }),
      );
