import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { ServerSettings, ServerSettingsPatch } from "./settings.ts";

it("defaults to new threads and accepts a saved preference", () => {
  expect(Schema.decodeUnknownSync(ServerSettings)({}).agentScheduledTasksUseCurrentThread).toBe(
    false,
  );
  expect(
    Schema.decodeUnknownSync(ServerSettings)({ agentScheduledTasksUseCurrentThread: true })
      .agentScheduledTasksUseCurrentThread,
  ).toBe(true);
  expect(
    Schema.decodeUnknownSync(ServerSettingsPatch)({ agentScheduledTasksUseCurrentThread: true }),
  ).toEqual({ agentScheduledTasksUseCurrentThread: true });
});
