import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ServerConfig, ServerConfigStreamEvent } from "./server.ts";
import { SlurmJobStatus } from "./slurmJob.ts";

const status = {
  jobId: "16656532",
  state: "running",
  remainingSeconds: 600,
  observedAt: 1000,
  serverNow: 2000,
};

describe("Slurm wire contract", () => {
  it("allows old servers and absent allocations, and decodes the opt-in event", () => {
    const config = Schema.decodeUnknownSync(
      Schema.Struct({ slurmJobStatus: ServerConfig.fields.slurmJobStatus }),
    );
    expect(config({})).toEqual({});
    expect(config({ slurmJobStatus: null })).toEqual({ slurmJobStatus: null });
    expect(config({ slurmJobStatus: status })).toEqual({ slurmJobStatus: status });
    const decode = Schema.decodeUnknownSync(ServerConfigStreamEvent);
    expect(decode({ version: 1, type: "slurmJobStatusUpdated", payload: status })).toMatchObject({
      payload: status,
    });
    expect(decode({ version: 1, type: "slurmJobStatusUpdated", payload: null })).toMatchObject({
      payload: null,
    });
  });

  it("rejects invalid time values and unknown states", () => {
    const decode = Schema.decodeUnknownSync(SlurmJobStatus);
    for (const patch of [
      { remainingSeconds: -1 },
      { remainingSeconds: Infinity },
      { remainingSeconds: 0.5 },
      { serverNow: -1 },
      { state: "made-up" },
    ]) {
      expect(() => decode({ ...status, ...patch })).toThrow();
    }
  });
});
