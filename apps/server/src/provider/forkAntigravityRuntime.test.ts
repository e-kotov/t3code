import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { checkAntigravityRuntime } from "./forkAntigravityRuntime.ts";

it.effect("requires replacing affected ACP installations before they can start", () =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("antigravity");
    for (const version of ["1.4.2", "1.4.3", "1.4.4", "v1.4.3"]) {
      const error = yield* checkAntigravityRuntime(version, instanceId).pipe(Effect.flip);
      expect(error).toMatchObject({ instanceId, operation: "resolve" });
      expect(error.detail).toContain(`Antigravity ACP ${version}`);
      expect(error.detail).toContain("Update Antigravity");
      expect(error.detail).toContain("Binary path");
    }
    for (const version of [null, "1.3.0", "1.4.1", "1.4.10", "2.0.0"]) {
      yield* checkAntigravityRuntime(version, instanceId);
    }
  }),
);
