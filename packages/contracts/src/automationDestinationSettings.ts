import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const automationDestinationSettings = {
  agentScheduledTasksUseCurrentThread: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
};

export const automationDestinationSettingsPatch = {
  agentScheduledTasksUseCurrentThread: Schema.optionalKey(Schema.Boolean),
};
