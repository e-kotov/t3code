// @effect-diagnostics nodeBuiltinImport:off -- Real harmless subprocesses prove split output and bounded parsing.
import { describe, expect, it } from "vite-plus/test";
import { UtilityProcessRunner } from "./UtilityProcessRunner.ts";

const input = { serviceId: "sample", actionId: null, revision: 1, timeoutSeconds: 3 };
describe("utility subprocess boundary", () => {
  it("captures stderr separately from stdout", async () => {
    const processRun = new UtilityProcessRunner().start({
      ...input,
      command: "printf '{\"version\":1}'; printf 'diagnostic' >&2",
    });
    const result = await processRun.promise;
    expect(result.stdout).toBe('{"version":1}');
    expect(result.stderr).toBe("diagnostic");
    expect(result.exitCode).toBe(0);
  });
  it("terminates its own process group on deadline", async () => {
    const processRun = new UtilityProcessRunner().start({
      ...input,
      timeoutSeconds: 1,
      command: "sleep 30",
    });
    const result = await processRun.promise;
    expect(result.error).toBe("Execution deadline exceeded.");
    expect(result.finishedAt! - result.startedAt).toBeLessThan(5000);
  });
  it("rejects oversized stdout instead of parsing its truncated tail", async () => {
    const processRun = new UtilityProcessRunner().start({
      ...input,
      command: "head -c 40000 /dev/zero",
    });
    const result = await processRun.promise;
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(32768);
    expect(result.error).toContain("exceeded");
  });
});
