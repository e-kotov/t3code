import type { ServerConfigStreamEvent, SlurmJobStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ProcessRunner from "../processRunner.ts";

export class SlurmJob extends Context.Service<
  SlurmJob,
  {
    readonly current: Effect.Effect<SlurmJobStatus | null>;
    readonly streamChanges: Stream.Stream<SlurmJobStatus | null>;
  }
>()("t3/environment/SlurmJob") {}

function durationSeconds(value: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (minutes >= 60 || seconds >= 60 || (days > 0 && hours >= 24)) return null;
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

function parseJob(stdout: string, jobId: string, uid: number, now: number): SlurmJobStatus | null {
  const lines = stdout.trim().split("\n");
  if (lines.length !== 1) return null;
  const [id, state, left, userId, extra] = lines[0]!.trim().split("|");
  if (id !== jobId || userId !== String(uid) || extra !== undefined || !left) return null;
  const remainingSeconds = left === "UNLIMITED" ? null : durationSeconds(left);
  if (remainingSeconds === null && left !== "UNLIMITED") return null;
  return {
    jobId,
    state:
      state === "RUNNING"
        ? "running"
        : state === "SUSPENDED"
          ? "suspended"
          : /^(COMPLETED|CANCELLED|FAILED|TIMEOUT|NODE_FAIL|PREEMPTED|OUT_OF_MEMORY|BOOT_FAIL|DEADLINE|REVOKED)$/.test(
                state ?? "",
              )
            ? "ended"
            : "unknown",
    remainingSeconds,
    observedAt: now,
    serverNow: now,
  };
}

/** @public Service construction permits external Slurm and filesystem test layers. */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const uid = yield* HostProcess.UserId;
  const jobId = environment.SLURM_JOB_ID ?? environment.SLURM_JOBID;
  const disabled = SlurmJob.of({ current: Effect.succeed(null), streamChanges: Stream.empty });
  if (platform !== "linux" || uid === undefined || !jobId || !/^\d+$/.test(jobId)) return disabled;

  const fs = yield* FileSystem.FileSystem;
  const cgroup = yield* fs.readFileString("/proc/self/cgroup").pipe(Effect.orElseSucceed(() => ""));
  if (!/slurm(?:stepd\.scope|\/|_)/.test(cgroup)) return disabled;

  const runner = yield* ProcessRunner.ProcessRunner;
  const now = yield* Clock.currentTimeMillis;
  const status = yield* SubscriptionRef.make<SlurmJobStatus>({
    jobId,
    state: "unknown",
    remainingSeconds: null,
    observedAt: now,
    serverNow: now,
  });
  let verified = false;
  let failures = 0;
  const run = (command: string, args: ReadonlyArray<string>, maxOutputBytes: number) =>
    runner
      .run({
        command,
        args,
        timeout: "3 seconds",
        timeoutBehavior: "timedOutResult",
        maxOutputBytes,
      })
      .pipe(
        Effect.map((result) =>
          result.code === 0 &&
          !result.timedOut &&
          !result.stdoutTruncated &&
          !result.stdoutInvalidUtf8
            ? result.stdout
            : null,
        ),
        Effect.orElseSucceed(() => null),
      );

  const poll = Effect.gen(function* () {
    // GWDG's cgroup v2 scope has an opaque ID. Ask the local Slurm daemon for
    // this PID's membership rather than trusting an inherited job variable.
    if (!verified) {
      const pids = yield* run("scontrol", ["listpids", jobId], 1024 * 1024);
      verified =
        pids !== null &&
        pids.split("\n").some((line) => {
          const [pid, job] = line.trim().split(/\s+/);
          return pid === String(process.pid) && job === jobId;
        });
    }
    const output = verified
      ? yield* run(
          "squeue",
          ["--local", "--noheader", "--jobs", jobId, "--format=%i|%T|%L|%U"],
          4096,
        )
      : null;
    const sampledAt = yield* Clock.currentTimeMillis;
    const next = output === null ? null : parseJob(output, jobId, uid, sampledAt);
    failures = next === null ? failures + 1 : 0;
    // Failure never renews the last successful observation. Publish its age
    // so a newly connected client also knows when the estimate became stale.
    yield* SubscriptionRef.update(
      status,
      (previous) => next ?? { ...previous, serverNow: sampledAt },
    );
  });
  yield* Effect.forever(
    Effect.gen(function* () {
      yield* poll;
      yield* Effect.sleep(Math.min(120_000 * 2 ** Math.min(failures, 3), 600_000));
    }),
  ).pipe(Effect.forkScoped);

  const stamp = (value: SlurmJobStatus) =>
    Clock.currentTimeMillis.pipe(Effect.map((serverNow) => ({ ...value, serverNow })));
  return SlurmJob.of({
    current: SubscriptionRef.get(status).pipe(Effect.flatMap(stamp)),
    streamChanges: SubscriptionRef.changes(status).pipe(Stream.mapEffect(stamp)),
  });
});

export const layer = Layer.effect(SlurmJob, make).pipe(Layer.provide(ProcessRunner.layer));

export function withStatusUpdates<E, R>(
  updates: Stream.Stream<ServerConfigStreamEvent, E, R>,
  status: Stream.Stream<SlurmJobStatus | null>,
  enabled: boolean,
) {
  return enabled
    ? Stream.merge(
        updates,
        status.pipe(
          Stream.map((payload) => ({
            version: 1 as const,
            type: "slurmJobStatusUpdated" as const,
            payload,
          })),
        ),
      )
    : updates;
}

/** Upstream RPC consumers can omit this optional host metadata service. */
export const optional = Effect.serviceOption(SlurmJob).pipe(
  Effect.map(Option.getOrElse(() => SlurmJob.of({
    current: Effect.succeed(null),
    streamChanges: Stream.empty,
  }))),
);
