// @effect-diagnostics nodeBuiltinImport:off -- Native child-process stream fixtures exercise the desktop adapter without a shell or desktop session.
import type { DeviceCommand, DeviceCommandRun } from "@t3tools/contracts";
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import { describe, expect, it } from "vite-plus/test";

import { DeviceCommandsRunner, type DeviceCommandProcess } from "./DeviceCommandsRunner.ts";

const command: DeviceCommand = {
  id: "gwdg-up",
  name: "GWDG up",
  command: "gwdg-agent up",
  icon: "server",
  confirm: false,
  showInCommandPalette: true,
};

class FakeProcess extends NodeEvents.EventEmitter {
  readonly stdout = new NodeStream.PassThrough();
  readonly stderr = new NodeStream.PassThrough();
  readonly pid: number | undefined;
  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
}

function setup() {
  const spawned: Array<{ shell: string; args: ReadonlyArray<string>; child: FakeProcess }> = [];
  const kills: Array<[number, NodeJS.Signals]> = [];
  const timers: Array<() => void> = [];
  const updates: DeviceCommandRun[] = [];
  let clock = 1_000;
  const runner = new DeviceCommandsRunner({
    spawn: (shell, args) => {
      const child = new FakeProcess(42);
      spawned.push({ shell, args, child });
      return child as unknown as DeviceCommandProcess;
    },
    killGroup: (pid, signal) => kills.push([pid, signal]),
    shell: () => "/bin/zsh",
    now: () => clock++,
    newRunId: () => `run-${spawned.length + 1}`,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  runner.subscribe((run) => updates.push(run));
  return { runner, spawned, kills, timers, updates };
}

describe("DeviceCommandsRunner", () => {
  it("reuses an active command and allows a new run after it finishes", () => {
    const { runner, spawned } = setup();
    const first = runner.start(command);
    expect(runner.start(command).runId).toBe(first.runId);
    expect(spawned).toHaveLength(1);
    spawned[0]!.child.emit("close", 0, null);
    expect(runner.start(command).runId).not.toBe(first.runId);
    expect(spawned).toHaveLength(2);
  });
  it("runs the stored text in a login shell and reports success", () => {
    const { runner, spawned, updates } = setup();
    const started = runner.start(command);
    expect(spawned[0]).toMatchObject({ shell: "/bin/zsh", args: ["-lc", "gwdg-agent up"] });
    expect(started.status).toBe("running");

    spawned[0]!.child.stdout.emit("data", Buffer.from("queued\n"));
    spawned[0]!.child.stderr.emit("data", "ready\n");
    spawned[0]!.child.emit("close", 0, null);

    const last = updates.at(-1)!;
    expect(last).toMatchObject({ status: "succeeded", exitCode: 0, output: "queued\nready\n" });
    expect(runner.runs()).toEqual([last]);
  });

  it("reports a non-zero exit as failed", () => {
    const { runner, spawned, updates } = setup();
    runner.start(command);
    spawned[0]!.child.emit("close", 2, null);
    expect(updates.at(-1)).toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("stops the whole process group, escalating to SIGKILL", () => {
    const { runner, spawned, kills, timers, updates } = setup();
    const started = runner.start(command);
    runner.stop(started.runId);
    expect(kills).toEqual([[42, "SIGTERM"]]);
    timers.at(-1)!();
    expect(kills).toEqual([
      [42, "SIGTERM"],
      [42, "SIGKILL"],
    ]);
    spawned[0]!.child.emit("close", null, "SIGKILL");
    expect(updates.at(-1)).toMatchObject({ status: "stopped" });
  });

  it("records a spawn failure as a failed run", () => {
    const runner = new DeviceCommandsRunner({
      spawn: () => {
        throw new Error("spawn /bin/zsh ENOENT");
      },
      shell: () => "/bin/zsh",
      newRunId: () => "run-1",
    });
    const run = runner.start(command);
    expect(run).toMatchObject({ status: "failed", error: "spawn /bin/zsh ENOENT" });
    expect(runner.runs()).toEqual([run]);
  });
});
