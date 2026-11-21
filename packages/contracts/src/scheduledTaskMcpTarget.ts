import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const scheduledTaskMcpTarget = <Options extends Schema.Top>(options: Options) =>
  Schema.optional(
    Schema.Struct({
      providerInstanceId: ProviderInstanceId,
      model: TrimmedNonEmptyString,
      options,
    }).annotate({
      description:
        "Model for a new task that starts in a new thread. Use catalog IDs and options from orchestrator_capabilities.",
    }),
  );
