import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import { codexAppServerArgs } from "./codexLaunchArgs.ts";
import { withForkCodexTelemetryOff } from "./forkCodexTelemetry.ts";

describe("EK Codex telemetry", () => {
  it("turns Codex analytics, feedback and metrics off after launch args that turn them on", () => {
    const args = withForkCodexTelemetryOff(
      codexAppServerArgs("-c analytics.enabled=true -c feedback.enabled=true"),
    );
    // Codex applies repeated -c overrides in order, so the last one wins.
    NodeAssert.deepStrictEqual(args.slice(-6), [
      "-c",
      "analytics.enabled=false",
      "-c",
      "feedback.enabled=false",
      "-c",
      'otel.metrics_exporter="none"',
    ]);
    NodeAssert.ok(args.indexOf("analytics.enabled=true") < args.indexOf("analytics.enabled=false"));
  });
});
