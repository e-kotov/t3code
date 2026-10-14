import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as SlurmJob from "./SlurmJob.ts";

function harness(
  options: { job?: string; cgroup?: string; member?: boolean; platform?: NodeJS.Platform } = {},
) {
  const calls: ProcessRunner.ProcessRunInput[] = [];
  let output = "16656532|RUNNING|23:12:29|14190";
  let failed = false;
  const layer = Layer.effect(SlurmJob.SlurmJob, SlurmJob.make).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcess.Environment, { SLURM_JOB_ID: options.job ?? "16656532" }),
        Layer.succeed(HostProcess.Platform, options.platform ?? "linux"),
        Layer.succeed(HostProcess.UserId, 14190),
        FileSystem.layerNoop({
          readFileString: () =>
            Effect.succeed(
              options.cgroup ?? "0::/system.slice/slurmstepd.scope/opaque/step_batch/user/task_0",
            ),
        }),
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run: (input) => {
            calls.push(input);
            return Effect.succeed({
              stdout:
                input.command === "scontrol"
                  ? `PID JOBID STEPID LOCALID GLOBALID\n${options.member === false ? process.pid + 1 : process.pid} 16656532 batch - -\n`
                  : output,
              stderr: "",
              code: ChildProcessSpawner.ExitCode(failed ? 1 : 0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            });
          },
        }),
      ),
    ),
  );
  return {
    layer,
    calls,
    setOutput: (value: string) => {
      output = value;
    },
    fail: () => {
      failed = true;
    },
  };
}

const ready = (service: SlurmJob.SlurmJob["Service"]) =>
  service.streamChanges.pipe(
    Stream.filter((status) => status !== null && status.state !== "unknown"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe("Slurm allocation status", () => {
  it.effect("verifies the exact server PID before publishing scheduler data", () => {
    const h = harness();
    return Effect.gen(function* () {
      const service = yield* SlurmJob.SlurmJob;
      const status = yield* ready(service);
      expect(status).toMatchObject({
        jobId: "16656532",
        state: "running",
        remainingSeconds: 83549,
      });
      expect(h.calls.map((call) => call.command)).toEqual(["scontrol", "squeue"]);
      expect(h.calls[1]!.args).toContain("16656532");
      expect(h.calls.every((call) => call.timeout === "3 seconds")).toBe(true);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  it.effect("never queries a job belonging to another PID", () => {
    const h = harness({ member: false });
    return Effect.gen(function* () {
      const service = yield* SlurmJob.SlurmJob;
      yield* TestClock.adjust("1 second");
      expect((yield* service.current)?.state).toBe("unknown");
      expect(h.calls.map((call) => call.command)).toEqual(["scontrol"]);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  for (const options of [
    { job: "" },
    { job: "1; touch /tmp/no" },
    { cgroup: "0::/user.slice/session.scope" },
    { platform: "darwin" as const },
  ]) {
    it.effect(
      `does no polling outside a validated Linux Slurm context: ${JSON.stringify(options)}`,
      () => {
        const h = harness(options);
        return Effect.gen(function* () {
          const service = yield* SlurmJob.SlurmJob;
          expect(yield* service.current).toBeNull();
          expect(h.calls).toEqual([]);
        }).pipe(Effect.provide(h.layer), Effect.scoped);
      },
    );
  }

  it.effect("picks up extensions and suspension without restarting the server", () => {
    const h = harness();
    return Effect.gen(function* () {
      const service = yield* SlurmJob.SlurmJob;
      yield* ready(service);
      h.setOutput("16656532|RUNNING|1-03:00:00|14190");
      yield* TestClock.adjust("2 minutes");
      expect((yield* service.current)?.remainingSeconds).toBe(97200);
      h.setOutput("16656532|SUSPENDED|08:00:00|14190");
      yield* TestClock.adjust("2 minutes");
      expect((yield* service.current)?.state).toBe("suspended");
      expect(h.calls.filter((call) => call.command === "scontrol")).toHaveLength(1);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  for (const output of [
    "",
    "16656532|RUNNING|NOT_SET|14190",
    "16656532|RUNNING|01:99:00|14190",
    "16656532|RUNNING|09:00:00|999",
    "123|RUNNING|09:00:00|14190",
  ]) {
    it.effect(`does not renew an observation on invalid scheduler output: ${output}`, () => {
      const h = harness();
      return Effect.gen(function* () {
        const service = yield* SlurmJob.SlurmJob;
        const initial = yield* ready(service);
        h.setOutput(output);
        yield* TestClock.adjust("2 minutes");
        const status = yield* service.current;
        expect(status?.observedAt).toBe(initial?.observedAt);
        expect(status!.serverNow - status!.observedAt).toBe(120000);
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    });
  }

  it.effect("backs off scheduler failures while keeping the last success stale", () => {
    const h = harness();
    return Effect.gen(function* () {
      const service = yield* SlurmJob.SlurmJob;
      const initial = yield* ready(service);
      h.fail();
      yield* TestClock.adjust("5 minutes");
      const status = yield* service.current;
      expect(status?.observedAt).toBe(initial?.observedAt);
      expect(status!.serverNow - status!.observedAt).toBe(300000);
      expect(h.calls.filter((call) => call.command === "squeue")).toHaveLength(2);
    }).pipe(Effect.provide(h.layer), Effect.scoped);
  });

  for (const [output, state, seconds] of [
    ["RUNNING|UNLIMITED", "running", null],
    ["RUNNING|02:31", "running", 151],
    ["TIMEOUT|00:00", "ended", 0],
  ] as const) {
    it.effect(`handles ${output}`, () => {
      const h = harness();
      h.setOutput(`16656532|${output}|14190`);
      return Effect.gen(function* () {
        const service = yield* SlurmJob.SlurmJob;
        expect(yield* ready(service)).toMatchObject({ state, remainingSeconds: seconds });
      }).pipe(Effect.provide(h.layer), Effect.scoped);
    });
  }
});
