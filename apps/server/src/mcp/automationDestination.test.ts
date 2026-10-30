import { describe, expect, it } from "vite-plus/test";
import { defaultScheduledTaskBinding } from "./automationDestination.ts";

describe("scheduled task destination", () => {
  it("uses the environment preference only when no destination was requested", () => {
    expect(defaultScheduledTaskBinding(undefined, false, true)).toBe(false);
    expect(defaultScheduledTaskBinding(undefined, true, true)).toBe(true);
    expect(defaultScheduledTaskBinding(undefined, true, false)).toBe(false);
    expect(defaultScheduledTaskBinding(false, true, true)).toBe(false);
    expect(defaultScheduledTaskBinding(true, false, true)).toBe(true);
    expect(defaultScheduledTaskBinding(true, false, false)).toBe(true);
  });
});
