import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const ScheduledTaskThreadMode = Schema.Literals(["new-thread", "current-thread"]);

export const scheduledTaskThreadModeSettings = {
  scheduledTaskThreadMode: ScheduledTaskThreadMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("new-thread" as const)),
  ),
};

export const scheduledTaskThreadModePatch = {
  scheduledTaskThreadMode: Schema.optionalKey(ScheduledTaskThreadMode),
};

export const scheduledTaskThreadBinding = Schema.optional(
  Schema.Boolean.annotate({
    description:
      "Omit to use this environment's automation thread preference when creating a task, or preserve the existing binding when updating. True: post in this thread. False: a new thread per run in the selected project. Does not change the workspace of an existing task.",
  }),
);
