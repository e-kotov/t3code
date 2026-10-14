import type { ServerConfig, SlurmJobStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { slurmJobCountdownLabel } from "../connection/slurmJobCountdown.ts";
import { applyServerConfigProjection, withoutEnvironmentThemes } from "./serverConfigProjection.ts";

// Only the descriptor capabilities are read by the projection under test.
const config = (slurmJobStatus?: SlurmJobStatus | null) =>
  ({
    environment: { capabilities: {} },
    ...(slurmJobStatus === undefined ? {} : { slurmJobStatus }),
  }) as ServerConfig;
const status = (): SlurmJobStatus => ({
  jobId: "16656532",
  state: "running",
  remainingSeconds: 7200,
  observedAt: 0,
  serverNow: 0,
});
const snapshot = (value: ServerConfig) =>
  applyServerConfigProjection(Option.none(), { version: 1, type: "snapshot", config: value });

afterEach(() => vi.useRealTimers());

it("stamps at receipt and keeps that anchor when a late subscriber replays the same status", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const first = snapshot(config());
  const updated = Option.getOrThrow(
    applyServerConfigProjection(first, {
      version: 1,
      type: "slurmJobStatusUpdated",
      payload: status(),
    }),
  );
  vi.advanceTimersByTime(240000);
  const replayed = Option.getOrThrow(snapshot(updated.config));
  vi.advanceTimersByTime(60000);
  expect(slurmJobCountdownLabel(replayed.config.slurmJobStatus, true)).toBe("time ?");
});

it("removes expired allocation state from persistent config caches", () => {
  const live = config(status());
  expect(withoutEnvironmentThemes(live).slurmJobStatus).toBeUndefined();
  expect(live.slurmJobStatus).toBeDefined();
});

it("clears the allocation on null updates and when reconnecting to an older server", () => {
  const first = snapshot(config(status()));
  const removed = Option.getOrThrow(
    applyServerConfigProjection(first, {
      version: 1,
      type: "slurmJobStatusUpdated",
      payload: null,
    }),
  );
  expect(removed.config.slurmJobStatus).toBeNull();
  const older = Option.getOrThrow(
    applyServerConfigProjection(first, { version: 1, type: "snapshot", config: config() }),
  );
  expect(older.config.slurmJobStatus).toBeUndefined();
});
