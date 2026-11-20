import {
  type ModelSelection,
  OrchestratorMcpFailure,
  type OrchestratorMcpScheduleTaskInput,
  type ProviderInstanceId,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolveRuntimeMode } from "./delegatedTaskModes.ts";

type ScheduledTaskTarget = NonNullable<OrchestratorMcpScheduleTaskInput["target"]>;

export const resolveScheduledTaskExecution = Effect.fn("resolveScheduledTaskExecution")(
  function* (config: {
    readonly input: Pick<OrchestratorMcpScheduleTaskInput, "target" | "freshSession">;
    readonly bindToCurrentThread: boolean;
    readonly runtimeMode: RuntimeMode;
    readonly inherited: ModelSelection | undefined;
    readonly projectDefault: Effect.Effect<ModelSelection, OrchestratorMcpFailure>;
    readonly providerEnabled: (instanceId: ProviderInstanceId) => boolean;
    readonly resolve: (
      target: ScheduledTaskTarget,
      inherited: ModelSelection,
    ) => Effect.Effect<
      {
        readonly modelSelection: ModelSelection;
        readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
      },
      OrchestratorMcpFailure
    >;
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
    if (!config.providerEnabled(target.providerInstanceId)) {
      return yield* new OrchestratorMcpFailure({
        code: "provider_unavailable",
        message: `Provider ${target.providerInstanceId} is disabled for this project.`,
      });
    }
    const resolved = yield* config.resolve(
      target,
      config.inherited ?? { instanceId: target.providerInstanceId, model: target.model },
    );
    return {
      modelSelection: resolved.modelSelection,
      runtimeMode: yield* resolveRuntimeMode(config.runtimeMode, undefined, resolved),
    };
  },
);
