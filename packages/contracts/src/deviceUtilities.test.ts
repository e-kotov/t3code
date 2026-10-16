import { describe, expect, it } from "vite-plus/test";
import {
  decodeUtilityConfig,
  readUtilityResult,
  utilityAggregate,
  utilityObservation,
  utilityServiceObservation,
  type UtilityExecution,
  type UtilitySnapshot,
} from "./deviceUtilities.ts";

const config = () =>
  decodeUtilityConfig(
    JSON.stringify({
      version: 1,
      services: [{ id: "vpn", name: "VPN", target: "Shared owner", check: "status --json" }],
    }),
  );
const run = (changes: Partial<UtilityExecution> = {}): UtilityExecution => ({
  runId: "r",
  serviceId: "vpn",
  actionId: null,
  revision: 1,
  startedAt: 1000,
  finishedAt: 2000,
  exitCode: 0,
  error: null,
  stdout: JSON.stringify({
    version: 1,
    services: [{ id: "vpn", status: "down", summary: "not connected" }],
  }),
  stderr: "diagnostic",
  truncated: false,
  ...changes,
});
describe("device utilities protocol", () => {
  it("keeps valid down observations separate from execution failure and stderr", () => {
    expect(readUtilityResult(run(), 3000).status).toBe("down");
    expect(() => readUtilityResult(run({ exitCode: 1 }), 3000)).toThrow("exit 1");
    expect(() => readUtilityResult(run({ truncated: true }), 3000)).toThrow("truncated");
    expect(() => readUtilityResult(run({ stdout: "noise\n{}" }), 3000)).toThrow();
  });
  it("rejects duplicate IDs, malformed versions and unsafe intervals", () => {
    const service = config().services[0]!;
    expect(() =>
      decodeUtilityConfig(JSON.stringify({ version: 1, services: [service, service] })),
    ).toThrow("Duplicate");
    expect(() => decodeUtilityConfig(JSON.stringify({ version: 2, services: [] }))).toThrow();
    expect(() =>
      decodeUtilityConfig(
        JSON.stringify({ version: 1, services: [{ ...service, intervalSeconds: 1 }] }),
      ),
    ).toThrow("interval");
    expect(() =>
      readUtilityResult(run({ stdout: JSON.stringify({ version: 1, services: [] }) }), 3000),
    ).toThrow("missing");
  });
  it("expires from check start and keeps the last observation details", () => {
    const service = config().services[0]!;
    expect(utilityObservation(service, run(), 3000).status).toBe("down");
    const stale = utilityObservation(service, run(), 122000);
    expect(stale.status).toBe("stale");
    expect(stale.result?.summary).toBe("not connected");
    expect(utilityObservation({ ...service, enabled: false }, run(), 3000).status).toBe("inactive");
  });
  it("follows the agreed mixed colors and excludes inactive services", () => {
    expect(utilityAggregate(["healthy", "inactive"])).toBe("healthy");
    expect(utilityAggregate(["healthy", "down"])).toBe("mixed");
    expect(utilityAggregate(["healthy", "unknown"])).toBe("mixed");
    expect(utilityAggregate(["down", "down"])).toBe("down");
    expect(utilityAggregate(["stale", "unknown"])).toBe("unknown");
    expect(utilityAggregate(["inactive"])).toBe("unknown");
  });
  it("never displays old green during an action or configuration error", () => {
    const snapshot: UtilitySnapshot = {
      config: config(),
      configPath: "/config",
      revision: 1,
      error: null,
      checks: [run()],
      actions: [run({ actionId: "restart", finishedAt: null })],
    };
    expect(utilityServiceObservation(snapshot, config().services[0]!, 3000).status).toBe("unknown");
    expect(
      utilityServiceObservation(
        { ...snapshot, error: "Invalid config", actions: [] },
        config().services[0]!,
        3000,
      ).reason,
    ).toBe("Invalid config");
  });
  it("requires real timezone-bearing lifecycle timestamps and bounded reports", () => {
    const stdout = (stamp: string) =>
      JSON.stringify({
        version: 1,
        services: [{ id: "vpn", status: "healthy", summary: "ok", startedAt: stamp }],
      });
    expect(() => readUtilityResult(run({ stdout: stdout("2050-01-01T00:00:00Z") }), 3000)).toThrow(
      "timestamp",
    );
    expect(() => readUtilityResult(run({ stdout: stdout("2026-10-16 12:00") }), 3000)).toThrow(
      "timestamp",
    );
    expect(readUtilityResult(run(), 3000).lastRestartedAt).toBeNull();
  });
});
