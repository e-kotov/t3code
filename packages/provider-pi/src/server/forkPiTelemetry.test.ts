import { assert, describe, it } from "@effect/vitest";

import { buildPiRpcLaunch } from "./mcpInjection.ts";

describe("EK Pi telemetry", () => {
  it("launches Pi with its telemetry off, even when the server environment turns it on", () => {
    for (const environment of [{}, { PI_TELEMETRY: "1", PATH: "/usr/bin" }]) {
      const launch = buildPiRpcLaunch({
        launchArgs: [],
        environment,
        mcpSession: undefined,
        extensionPath: undefined,
      });
      assert.equal(launch.env.PI_TELEMETRY, "0");
    }
  });
});
