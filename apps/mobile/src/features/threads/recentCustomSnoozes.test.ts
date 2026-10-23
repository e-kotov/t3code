import { expect, it, vi } from "vite-plus/test";
import * as SecureStore from "expo-secure-store";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { resolveCustomSnooze, resolveThreadListV2SnoozeMenuSelection } from "./recentCustomSnoozes";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
}));

it("remembers only custom date choices and handles recent versus built-in menu selections", async () => {
  const now = new Date(2026, 9, 23, 10, 0);
  const persisted = Promise.withResolvers<string>();
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => {
    persisted.resolve(value);
  });
  const date = resolveCustomSnooze({ mode: "date", date: "2026-10-24", time: "15:47" }, now);
  expect(date).toBe(new Date(2026, 9, 24, 15, 47).toISOString());
  expect(JSON.parse(await persisted.promise)).toEqual([date]);
  resolveCustomSnooze({ mode: "duration", amount: "2", unit: "hours" }, now);
  resolveCustomSnooze({ mode: "date", date: "invalid", time: "15:47" }, now);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);

  const preset = { id: `recent:${date}`, label: "Recent", whenLabel: "15:47", snoozedUntil: date! };
  expect(
    resolveThreadListV2SnoozeMenuSelection({
      event: `snooze:${preset.id}`,
      displayedPresets: [preset],
      now,
    }),
  ).toEqual({ _tag: "selected", preset });
  expect(
    resolveThreadListV2SnoozeMenuSelection({
      event: `snooze:${preset.id}`,
      displayedPresets: [preset],
      now: new Date(date!),
    }),
  ).toEqual({ _tag: "expired" });
  const later = new Date(2026, 9, 23, 11, 0);
  const selected = resolveThreadListV2SnoozeMenuSelection({
    event: "snooze:hour",
    displayedPresets: resolveSnoozePresets(now),
    now: later,
  });
  expect(selected._tag).toBe("selected");
  if (selected._tag === "selected")
    expect(selected.preset.snoozedUntil).toBe(new Date(2026, 9, 23, 12, 0).toISOString());
});
