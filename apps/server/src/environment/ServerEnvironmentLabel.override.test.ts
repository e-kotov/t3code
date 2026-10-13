import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel.ts";

const runMock = vi.fn();

function layer(env: Record<string, string>) {
  return Layer.mergeAll(
    Layer.succeed(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({ run: (input) => runMock(input) }),
    ),
    FileSystem.layerNoop({
      exists: (path) => Effect.succeed(path === "/etc/machine-info"),
      readFileString: () => Effect.succeed('PRETTY_HOSTNAME="Build Agent 01"\n'),
    }),
    Layer.succeed(HostProcess.Platform, "linux"),
    Layer.succeed(HostProcess.Hostname, "agq009"),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
  );
}

describe("T3CODE_ENVIRONMENT_LABEL", () => {
  it.effect("names the server regardless of the host it runs on", () =>
    Effect.gen(function* () {
      const label = yield* resolveServerEnvironmentLabel({ cwdBaseName: "t3" }).pipe(
        Effect.provide(layer({ T3CODE_ENVIRONMENT_LABEL: "  GWDG  " })),
      );
      expect(label).toBe("GWDG");
      expect(runMock).not.toHaveBeenCalled();
    }),
  );

  it.effect("falls back to the host's own name when unset or blank", () =>
    Effect.gen(function* () {
      const unset = yield* resolveServerEnvironmentLabel({ cwdBaseName: "t3" }).pipe(
        Effect.provide(layer({})),
      );
      const blank = yield* resolveServerEnvironmentLabel({ cwdBaseName: "t3" }).pipe(
        Effect.provide(layer({ T3CODE_ENVIRONMENT_LABEL: "   " })),
      );
      expect(unset).toBe("Build Agent 01");
      expect(blank).toBe("Build Agent 01");
    }),
  );
});
