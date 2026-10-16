// @effect-diagnostics nodeBuiltinImport:off -- Native subprocess boundary; owns only process groups captured at spawn.
// @effect-diagnostics globalTimers:off -- Native process deadlines must survive renderer suspension.
import { UTILITY_OUTPUT_LIMIT, type UtilityExecution } from "@t3tools/contracts";
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";

export class UtilityProcessRunner {
  start(input: {
    serviceId: string;
    actionId: string | null;
    revision: number;
    command: string;
    timeoutSeconds: number;
  }) {
    let child: ChildProcess.ChildProcess | undefined;
    let done = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const result: UtilityExecution = {
      runId: Crypto.randomUUID(),
      serviceId: input.serviceId,
      actionId: input.actionId,
      revision: input.revision,
      startedAt: Date.now(),
      finishedAt: null,
      exitCode: null,
      error: null,
      stdout: "",
      stderr: "",
      truncated: false,
    };
    // The returned run stays immutable at the wire boundary; only this adapter mutates it.
    const run = { ...result };
    let finish: (code: number | null) => void = () => undefined;
    const signal = (value: NodeJS.Signals) => {
      if (child?.pid === undefined) return;
      try {
        process.kill(-child.pid, value);
      } catch {
        /* Already exited. */
      }
    };
    const stop = (reason = "Check superseded.") => {
      if (done) return;
      run.error = reason;
      signal("SIGTERM");
      escalation ??= setTimeout(() => signal("SIGKILL"), 1000);
    };
    const promise = new Promise<UtilityExecution>((resolve) => {
      finish = (code) => {
        if (done) return;
        done = true;
        if (deadline) clearTimeout(deadline);
        if (escalation) clearTimeout(escalation);
        resolve({ ...run, finishedAt: Date.now(), exitCode: code });
      };
      try {
        child = ChildProcess.spawn(process.env.SHELL || "/bin/sh", ["-lc", input.command], {
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          cwd: process.env.HOME,
          env: process.env,
        });
        child.stdout?.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          run.stdout = (run.stdout + chunk.toString()).slice(0, UTILITY_OUTPUT_LIMIT);
          if (stdoutBytes > UTILITY_OUTPUT_LIMIT) {
            run.truncated = true;
            stop("Check stdout exceeded 32 KiB.");
          }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderrBytes += chunk.length;
          run.stderr = (run.stderr + chunk.toString()).slice(0, UTILITY_OUTPUT_LIMIT);
          if (stderrBytes > UTILITY_OUTPUT_LIMIT) {
            run.truncated = true;
            stop("Check stderr exceeded 32 KiB.");
          }
        });
        child.on("error", (error) => {
          run.error = error.message;
          if (child?.pid === undefined) finish(null);
        });
        child.on("close", (code) => finish(code));
        deadline = setTimeout(
          () => stop("Execution deadline exceeded."),
          input.timeoutSeconds * 1000,
        );
      } catch (cause) {
        run.error = String(cause);
        finish(null);
      }
    });
    return { run: result, promise, stop };
  }
}
