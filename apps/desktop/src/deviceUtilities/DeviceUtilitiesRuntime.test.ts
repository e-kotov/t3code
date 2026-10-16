// @effect-diagnostics nodeBuiltinImport:off -- Temporary files and controlled native process events exercise device boundaries.
import * as FS from "node:fs/promises";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DeviceUtilitiesRuntime } from "./DeviceUtilitiesRuntime.ts";
import { UtilityProcessRunner } from "./UtilityProcessRunner.ts";
import { UTILITY_CONFIG_PATH, type UtilityExecution } from "@t3tools/contracts";

const homes: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const home of homes.splice(0)) await FS.rm(home, { recursive: true, force: true });
});
async function setup() {
  const home = await FS.mkdtemp(Path.join(OS.tmpdir(), "utilities-"));
  homes.push(home);
  const file = Path.join(home, UTILITY_CONFIG_PATH);
  await FS.mkdir(Path.dirname(file), { recursive: true });
  await FS.writeFile(
    file,
    JSON.stringify({
      version: 1,
      services: [
        {
          id: "vpn",
          name: "VPN",
          target: "owner",
          check: "check",
          actions: [{ id: "restart", name: "Restart", command: "restart", scope: "shared" }],
        },
      ],
    }),
  );
  const pending: {
    input: Parameters<UtilityProcessRunner["start"]>[0];
    resolve: (run: Partial<UtilityExecution>) => void;
    stopped: boolean;
  }[] = [];
  const runner = new UtilityProcessRunner();
  vi.spyOn(runner, "start").mockImplementation((input) => {
    const run: UtilityExecution = {
      runId: String(pending.length),
      revision: input.revision,
      serviceId: input.serviceId,
      actionId: input.actionId,
      startedAt: Date.now(),
      finishedAt: null,
      stdout: "",
      stderr: "",
      exitCode: null,
      error: null,
      truncated: false,
    };
    let resolve = (_value: UtilityExecution) => {
      return;
    };
    const promise = new Promise<UtilityExecution>((done) => {
      resolve = done;
    });
    const entry = {
      input,
      resolve: (value: Partial<UtilityExecution>) => resolve({ ...run, ...value }),
      stopped: false,
    };
    pending.push(entry);
    return {
      run,
      promise,
      stop: () => {
        entry.stopped = true;
        resolve({ ...run, finishedAt: Date.now(), error: "superseded" });
      },
    };
  });
  return { runtime: new DeviceUtilitiesRuntime(home, runner), pending, file };
}
describe("device utilities runtime", () => {
  it("coalesces multiple windows and refuses an action confirmed against an old config", async () => {
    const { runtime, pending } = await setup();
    const first = await runtime.snapshot();
    await runtime.active("a", true);
    await runtime.active("b", true);
    await runtime.check();
    expect(pending).toHaveLength(1);
    await runtime.reload();
    expect(pending[0]!.stopped).toBe(true);
    await expect(runtime.action("vpn", "restart", first.revision)).rejects.toThrow(
      "Configuration changed",
    );
    runtime.dispose();
  });
  it("invalidates an earlier probe before an action and waits for a new observation", async () => {
    const { runtime, pending } = await setup();
    const initial = await runtime.snapshot();
    await runtime.check();
    await runtime.action("vpn", "restart", initial.revision);
    expect(pending[0]!.stopped).toBe(true);
    expect(pending).toHaveLength(2);
    await expect(runtime.action("vpn", "restart", initial.revision)).rejects.toThrow(
      "already running",
    );
    pending[1]!.resolve({ finishedAt: Date.now(), exitCode: 0 });
    await Promise.resolve();
    expect(pending).toHaveLength(3);
    expect((await runtime.snapshot()).checks).toEqual([]);
    runtime.dispose();
  });
  it("keeps invalid config on disk and pauses monitoring", async () => {
    const { runtime, pending, file } = await setup();
    await runtime.snapshot();
    await FS.writeFile(file, "invalid");
    const state = await runtime.reload();
    expect(state.error).not.toBeNull();
    await runtime.check();
    expect(pending).toHaveLength(0);
    expect(await FS.readFile(file, "utf8")).toBe("invalid");
    runtime.dispose();
  });
});
