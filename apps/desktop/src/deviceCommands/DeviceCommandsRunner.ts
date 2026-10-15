// @effect-diagnostics nodeBuiltinImport:off -- This desktop process adapter owns native POSIX process groups and child-process streams.
// @effect-diagnostics globalTimers:off -- Child-process callbacks coalesce output and enforce a native shutdown deadline outside Effect fibers.
import {
  appendDeviceCommandOutput,
  finishedDeviceCommandStatus,
  type DeviceCommand,
  type DeviceCommandRun,
} from "@t3tools/contracts";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

/** Grace period between SIGTERM and SIGKILL when a run is stopped. */
const STOP_GRACE_MS = 5_000;
/** Output updates are coalesced so a chatty command does not flood the renderer. */
const PUBLISH_INTERVAL_MS = 150;
/** Finished runs kept for the menu: the latest per command is enough. */
const MAX_FINISHED_RUNS = 20;

export interface DeviceCommandProcess {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface DeviceCommandsRunnerOptions {
  readonly spawn?: (shell: string, args: ReadonlyArray<string>) => DeviceCommandProcess;
  /** Signals the whole process group, so children such as ssh stop too. */
  readonly killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  readonly shell?: () => string;
  readonly now?: () => number;
  readonly newRunId?: () => string;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

interface ActiveRun {
  run: DeviceCommandRun;
  readonly process: DeviceCommandProcess;
  stopRequested: boolean;
  publishTimer: unknown;
  killTimer: unknown;
}

const defaultSpawn = (shell: string, args: ReadonlyArray<string>): DeviceCommandProcess =>
  NodeChildProcess.spawn(shell, [...args], {
    // A process group of its own lets Stop reach everything the command started.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    cwd: process.env.HOME,
  });

const defaultKillGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
};

const defaultShell = () => process.env.SHELL || "/bin/sh";

/**
 * Runs device commands in the user's login shell. Desktop startup has already
 * merged the login-shell environment into `process.env`, so `-lc` finds tools
 * such as `gwdg-agent` on the user's PATH without an interactive shell.
 */
export class DeviceCommandsRunner {
  private readonly active = new Map<string, ActiveRun>();
  private finished: DeviceCommandRun[] = [];
  private readonly listeners = new Set<(run: DeviceCommandRun) => void>();
  private readonly spawnProcess: NonNullable<DeviceCommandsRunnerOptions["spawn"]>;
  private readonly killGroup: NonNullable<DeviceCommandsRunnerOptions["killGroup"]>;
  private readonly resolveShell: () => string;
  private readonly now: () => number;
  private readonly newRunId: () => string;
  private readonly setTimer: NonNullable<DeviceCommandsRunnerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<DeviceCommandsRunnerOptions["clearTimer"]>;

  constructor(options: DeviceCommandsRunnerOptions = {}) {
    this.spawnProcess = options.spawn ?? defaultSpawn;
    this.killGroup = options.killGroup ?? defaultKillGroup;
    this.resolveShell = options.shell ?? defaultShell;
    this.now = options.now ?? Date.now;
    this.newRunId = options.newRunId ?? (() => NodeCrypto.randomUUID());
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  subscribe(listener: (run: DeviceCommandRun) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  runs(): ReadonlyArray<DeviceCommandRun> {
    return [...this.finished, ...[...this.active.values()].map((entry) => entry.run)];
  }

  start(command: DeviceCommand): DeviceCommandRun {
    const existing = [...this.active.values()].find((entry) => entry.run.commandId === command.id);
    if (existing) return existing.run;
    const run: DeviceCommandRun = {
      runId: this.newRunId(),
      commandId: command.id,
      commandName: command.name,
      status: "running",
      startedAt: this.now(),
      finishedAt: null,
      exitCode: null,
      output: "",
      outputTruncated: false,
      error: null,
    };

    let child: DeviceCommandProcess;
    try {
      child = this.spawnProcess(this.resolveShell(), ["-lc", command.command]);
    } catch (cause) {
      const failed: DeviceCommandRun = {
        ...run,
        status: "failed",
        finishedAt: this.now(),
        error: errorText(cause),
      };
      this.remember(failed);
      return failed;
    }

    const entry: ActiveRun = {
      run,
      process: child,
      stopRequested: false,
      publishTimer: null,
      killTimer: null,
    };
    this.active.set(run.runId, entry);

    const append = (chunk: Buffer | string) => {
      entry.run = { ...entry.run, ...appendDeviceCommandOutput(entry.run, chunk.toString()) };
      this.schedulePublish(entry);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      entry.run = { ...entry.run, error: errorText(error) };
      // A spawn failure emits no close event when the process never started.
      if (child.pid === undefined) this.finish(entry, null);
    });
    child.on("close", (code) => this.finish(entry, code));

    this.publish(entry.run);
    return entry.run;
  }

  stop(runId: string): void {
    const entry = this.active.get(runId);
    if (!entry || entry.stopRequested) return;
    entry.stopRequested = true;
    const pid = entry.process.pid;
    if (pid === undefined) return;
    this.killGroup(pid, "SIGTERM");
    entry.killTimer = this.setTimer(() => this.killGroup(pid, "SIGKILL"), STOP_GRACE_MS);
  }

  /** Stops every running command; used when the app quits. */
  stopAll(): void {
    for (const runId of this.active.keys()) this.stop(runId);
  }

  private finish(entry: ActiveRun, exitCode: number | null): void {
    if (!this.active.has(entry.run.runId)) return;
    this.active.delete(entry.run.runId);
    if (entry.publishTimer !== null) this.clearTimer(entry.publishTimer);
    if (entry.killTimer !== null) this.clearTimer(entry.killTimer);
    const finished: DeviceCommandRun = {
      ...entry.run,
      status: finishedDeviceCommandStatus({ exitCode, stopRequested: entry.stopRequested }),
      exitCode,
      finishedAt: this.now(),
    };
    this.remember(finished);
  }

  private remember(run: DeviceCommandRun): void {
    this.finished = [...this.finished.filter((item) => item.runId !== run.runId), run].slice(
      -MAX_FINISHED_RUNS,
    );
    this.publish(run);
  }

  private schedulePublish(entry: ActiveRun): void {
    if (entry.publishTimer !== null) return;
    entry.publishTimer = this.setTimer(() => {
      entry.publishTimer = null;
      if (this.active.has(entry.run.runId)) this.publish(entry.run);
    }, PUBLISH_INTERVAL_MS);
  }

  private publish(run: DeviceCommandRun): void {
    for (const listener of this.listeners) listener(run);
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
