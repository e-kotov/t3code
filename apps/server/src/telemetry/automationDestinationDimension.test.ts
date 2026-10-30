import { expect, it } from "vite-plus/test";
import { automationDestinationDimension } from "./automationDestinationDimension.ts";

it("reports the resulting destination without exposing the thread id", () => {
  expect(automationDestinationDimension({ boundThreadId: null })).toEqual({
    bindToCurrentThread: false,
  });
  expect(automationDestinationDimension({ boundThreadId: "thread" })).toEqual({
    bindToCurrentThread: true,
  });
  expect(automationDestinationDimension({})).toEqual({});
});
