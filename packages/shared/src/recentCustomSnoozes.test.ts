import { describe, expect, it } from "@effect/vitest";
import { createRecentCustomSnoozeStore, recentCustomSnoozes } from "./recentCustomSnoozes.ts";

const NOW = new Date("2026-10-23T12:00:00Z");
const dates = [
  "2026-10-24T12:00:00.000Z",
  "2026-10-25T12:00:00.000Z",
  "2026-10-26T12:00:00.000Z",
  "2026-10-27T12:00:00.000Z",
];

describe("recent custom snooze dates", () => {
  it("keeps three distinct future instants in selection order and removes expired or invalid data", () => {
    expect(
      recentCustomSnoozes(
        [
          null,
          "invalid",
          NOW.toISOString(),
          "2020-01-01",
          dates[0],
          "2026-10-24T14:00:00+02:00",
          ...dates.slice(1),
        ],
        NOW,
      ),
    ).toEqual(dates.slice(0, 3));
    expect(recentCustomSnoozes({ dates }, NOW)).toEqual([]);
    expect(recentCustomSnoozes(dates, new Date(dates[2]!))).toEqual([dates[3]]);
  });

  it("hydrates before recording, promotes reused dates, and persists across store instances", async () => {
    let saved: string | null = JSON.stringify(dates.slice(0, 3));
    const storage = {
      getItem: async () => saved,
      setItem: async (_key: string, value: string) => {
        saved = value;
      },
    };
    const store = createRecentCustomSnoozeStore(storage);
    await store.remember(dates[1]!, NOW);
    expect(store.getSnapshot()).toEqual([dates[1], dates[0], dates[2]]);
    await store.remember(dates[3]!, NOW);
    const reopened = createRecentCustomSnoozeStore(storage);
    await reopened.load();
    expect(reopened.getSnapshot()).toEqual([dates[3], dates[1], dates[0]]);
  });

  it("serializes concurrent writes so the last selection remains first after restart", async () => {
    let saved: string | null = null;
    let completeRead!: (value: string | null) => void;
    const reading = Promise.withResolvers<void>();
    const store = createRecentCustomSnoozeStore({
      getItem: () =>
        new Promise<string | null>((resolve) => {
          completeRead = resolve;
          reading.resolve();
        }),
      setItem: async (_key, value) => {
        saved = value;
      },
    });
    const loaded = store.load();
    // Start both selections during hydration, without timing assumptions.
    const selected = [store.remember(dates[0]!, NOW), store.remember(dates[1]!, NOW)];
    await reading.promise;
    completeRead(JSON.stringify([dates[2]]));
    await loaded;
    await Promise.all(selected);
    expect(JSON.parse(saved!)).toEqual([dates[1], dates[0], dates[2]]);
  });

  it("keeps snoozing usable with corrupt or unavailable persistence and ignores invalid selections", async () => {
    for (const raw of ["broken JSON", "{}", "null"]) {
      const store = createRecentCustomSnoozeStore({
        getItem: () => raw,
        setItem: () => {
          throw new Error("disk full");
        },
      });
      await store.remember(dates[0]!, NOW);
      await store.remember("invalid", NOW);
      await store.remember(NOW.toISOString(), NOW);
      expect(store.getSnapshot()).toEqual([dates[0]]);
    }
  });
});
