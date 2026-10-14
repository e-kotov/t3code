import type { SlurmJobStatus } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSlurmCountdownClock,
  receiveSlurmJobStatus,
  slurmJobCountdownLabel,
} from "./slurmJobCountdown.ts";

const origin = { wall: 100000, monotonic: 1000 };
function job(seconds: number | null, overrides: Partial<SlurmJobStatus> = {}) {
  return receiveSlurmJobStatus(
    {
      jobId: "16656532",
      state: "running",
      remainingSeconds: seconds,
      observedAt: 900000000,
      serverNow: 900000000,
      ...overrides,
    },
    origin,
  );
}

afterEach(() => vi.useRealTimers());

describe("compact Slurm time", () => {
  it.each([
    [47 * 3600 - 1, "<1d23h"],
    [86400, "<1d"],
    [86400 - 1, "<24h"],
    [21 * 3600, "<21h"],
    [16.55 * 3600, "<16.6h"],
    [9 * 3600, "<9h"],
    [9 * 3600 - 1, "9h"],
    [4 * 3600 + 31 * 60, "4h31m"],
    [3600, "1h"],
    [31 * 60, "31m"],
    [1, "1m"],
    [0, "due"],
  ])("formats %s seconds as %s", (seconds, label) => {
    expect(slurmJobCountdownLabel(job(seconds), true, origin)).toBe(label);
  });

  it("uses elapsed time rather than comparing the phone's UTC with the server", () => {
    const status = job(17 * 3600);
    expect(
      slurmJobCountdownLabel(status, true, {
        wall: origin.wall + 60000,
        monotonic: origin.monotonic + 60000,
      }),
    ).toBe("<17h");
    expect(
      slurmJobCountdownLabel(status, true, {
        wall: origin.wall - 3600000,
        monotonic: origin.monotonic + 120000,
      }),
    ).toBe("<17h");
  });

  it("counts server-side age and refuses stale, sleeping and disconnected estimates", () => {
    const status = job(3600, { serverNow: 900120000 });
    expect(slurmJobCountdownLabel(status, true, origin)).toBe("58m");
    expect(
      slurmJobCountdownLabel(status, true, {
        wall: origin.wall + 180000,
        monotonic: origin.monotonic,
      }),
    ).toBe("time ?");
    expect(slurmJobCountdownLabel(status, false, origin)).toBe("time ?");
  });

  it("does not reset the receipt time when a subscriber replays or a header remounts", () => {
    const status = job(3600);
    receiveSlurmJobStatus(status, {
      wall: origin.wall + 240000,
      monotonic: origin.monotonic + 240000,
    });
    expect(
      slurmJobCountdownLabel(status, true, {
        wall: origin.wall + 300000,
        monotonic: origin.monotonic + 300000,
      }),
    ).toBe("time ?");
    expect(slurmJobCountdownLabel(job(7200), true, origin)).toBe("2h");
  });

  it("distinguishes no allocation, unlimited, paused, unknown and confirmed ended", () => {
    expect(slurmJobCountdownLabel(undefined, true, origin)).toBeNull();
    expect(slurmJobCountdownLabel(null, true, origin)).toBeNull();
    expect(slurmJobCountdownLabel(job(null), true, origin)).toBe("∞");
    expect(slurmJobCountdownLabel(job(3600, { state: "suspended" }), true, origin)).toBe("paused");
    expect(slurmJobCountdownLabel(job(null, { state: "unknown" }), true, origin)).toBe("time ?");
    expect(slurmJobCountdownLabel(job(0, { state: "ended" }), true, origin)).toBe("ended");
  });
});

it("shares one timer, stops in the background, and refreshes immediately on resume", () => {
  vi.useFakeTimers();
  let active = true;
  let activity = () => {};
  const stopObserving = vi.fn();
  const subscribe = createSlurmCountdownClock(
    () => active,
    (refresh) => {
      activity = refresh;
      return stopObserving;
    },
  );
  const first = vi.fn();
  const second = vi.fn();
  const offFirst = subscribe(first);
  const offSecond = subscribe(second);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(60000);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  active = false;
  activity();
  expect(vi.getTimerCount()).toBe(0);
  active = true;
  activity();
  expect(first).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(1);
  offFirst();
  offSecond();
  expect(stopObserving).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
