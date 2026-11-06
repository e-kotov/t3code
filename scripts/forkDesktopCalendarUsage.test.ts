import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createBuildConfig } from "./build-desktop-artifact.ts";

// Without these disclosures macOS silently denies Calendar access to commands run
// inside the app and never lists the app under Privacy & Security > Calendars.
it.layer(NodeServices.layer)("fork desktop calendar usage descriptions", (it) => {
  it.effect("declares Calendar access for hosted commands in macOS builds", () =>
    Effect.gen(function* () {
      for (const version of ["0.1.0", "0.1.1-nightly.20261019.1"]) {
        for (const signed of [false, true]) {
          const config = yield* createBuildConfig(
            "mac",
            "dmg",
            version,
            signed,
            false,
            undefined,
            undefined,
          );
          const mac = config.mac as { extendInfo: Record<string, unknown> };
          for (const key of [
            "NSCalendarsUsageDescription",
            "NSCalendarsFullAccessUsageDescription",
            "NSCalendarsWriteOnlyAccessUsageDescription",
          ]) {
            assert.isString(mac.extendInfo[key], `${version}, signed=${signed}: ${key}`);
            assert.isNotEmpty(mac.extendInfo[key]);
          }
        }
      }
    }),
  );
});
