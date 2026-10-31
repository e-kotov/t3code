import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { ServerSettings, ServerSettingsPatch } from "./settings.ts";

const decodeSettings = Schema.decodeSync(ServerSettings);
const decodePatch = Schema.decodeSync(ServerSettingsPatch);

it("defaults to new threads and accepts a saved preference", () => {
  expect(decodeSettings({}).agentScheduledTasksUseCurrentThread).toBe(false);
  expect(
    decodeSettings({ agentScheduledTasksUseCurrentThread: true })
      .agentScheduledTasksUseCurrentThread,
  ).toBe(true);
  expect(decodePatch({ agentScheduledTasksUseCurrentThread: true })).toEqual({
    agentScheduledTasksUseCurrentThread: true,
  });
});
