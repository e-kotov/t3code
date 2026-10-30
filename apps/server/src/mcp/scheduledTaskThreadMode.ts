import { OrchestratorMcpFailure, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerSettings from "../serverSettings.ts";

export const resolveScheduledTaskThreadBinding = Effect.fn(
  "OrchestratorMcpService.resolveScheduledTaskThreadBinding",
)(function* (
  explicit: boolean | undefined,
  callerProjectId: ProjectId | undefined,
  projectId: ProjectId,
) {
  if (explicit !== undefined) return explicit;
  if (callerProjectId === undefined || callerProjectId !== projectId) return false;
  const settings = yield* ServerSettings.ServerSettingsService;
  const current = yield* settings.getSettings.pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Unable to read server settings.",
        }),
    ),
  );
  return current.scheduledTaskThreadMode === "current-thread";
});
