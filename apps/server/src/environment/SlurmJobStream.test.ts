import { expect, it } from "@effect/vitest";
import type { ServerConfig, SlurmJobStatus } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { withLateConfigDiscovery } from "../ws.ts";
import { optional, SlurmJob, withStatusUpdates } from "./SlurmJob.ts";

it.effect("emits the new event only to clients that opt in", () =>
  Effect.gen(function* () {
    const legacy = yield* withStatusUpdates(Stream.empty, Stream.make(null), false).pipe(
      Stream.runCollect,
    );
    const capable = yield* withStatusUpdates(Stream.empty, Stream.make(null), true).pipe(
      Stream.runCollect,
    );
    expect(legacy).toEqual([]);
    expect(capable).toEqual([{ version: 1, type: "slurmJobStatusUpdated", payload: null }]);
  }),
);

it.effect("late editor snapshots preserve the newest Slurm observation", () =>
  Effect.gen(function* () {
    const sent = yield* Deferred.make<void>();
    const job: SlurmJobStatus = {
      jobId: "16656532",
      state: "running",
      remainingSeconds: 3600,
      observedAt: 1000,
      serverNow: 1000,
    };
    const config = { availableEditors: [], slurmJobStatus: null } as unknown as ServerConfig;
    const events = yield* withLateConfigDiscovery(
      config,
      Stream.make({ version: 1, type: "slurmJobStatusUpdated", payload: job }),
      {
        resolveAvailableEditors: () =>
          Deferred.await(sent).pipe(Effect.as(["file-manager"] as const)),
        resolveFileManagerRevealKind: () => Effect.succeed("file-explorer" as const),
      },
      { resolveTargets: () => Effect.succeed([]) },
    ).pipe(
      Stream.tap((event) =>
        event.type === "slurmJobStatusUpdated" ? Deferred.succeed(sent, undefined) : Effect.void,
      ),
      Stream.runCollect,
    );
    expect(events.find((event) => event.type === "snapshot")?.config.slurmJobStatus).toEqual(job);
  }),
);

it.effect("keeps host metadata optional without hiding a provided Slurm service", () =>
  Effect.gen(function* () {
    const absent = yield* optional;
    expect(yield* absent.current).toBeNull();
    expect(yield* Stream.runCollect(absent.streamChanges)).toEqual([]);
    const provided = SlurmJob.of({ current: Effect.succeed(null), streamChanges: Stream.empty });
    expect(yield* optional.pipe(Effect.provideService(SlurmJob, provided))).toBe(provided);
  }),
);
