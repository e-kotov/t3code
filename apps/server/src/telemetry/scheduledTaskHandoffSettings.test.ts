import { expect, it } from "@effect/vitest";

import { handoffSettings } from "./ProviderDimensions.ts";

it("reports the saved scheduled-task binding rather than guessing from omitted input", () => {
  for (const args of [{}, { bindToCurrentThread: true }, { bindToCurrentThread: false }]) {
    expect(handoffSettings("schedule_task", args, { boundThreadId: null })).toEqual({
      bindToCurrentThread: false,
    });
    expect(handoffSettings("schedule_task", args, { boundThreadId: "private-thread-id" })).toEqual({
      bindToCurrentThread: true,
    });
  }
  for (const result of [undefined, {}, { code: "invalid_request" }, { boundThreadId: 123 }]) {
    expect(handoffSettings("schedule_task", {}, result)).toEqual({});
  }
});
