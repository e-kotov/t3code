import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ExternalLauncher from "./externalLauncher.ts";

const windowsHost = HostProcess.Platform.defaultValue() === "win32";

for (const { platform, editor, installPath, onPath } of [
  {
    platform: "darwin",
    editor: "positron",
    installPath: "Applications/Positron.app/Contents/Resources/app/bin/code",
    onPath: false,
  },
  {
    platform: "darwin",
    editor: "gram",
    installPath: "Applications/Gram.app/Contents/MacOS/cli",
    onPath: false,
  },
  { platform: "linux", editor: "positron", installPath: "bin/positron", onPath: true },
  { platform: "linux", editor: "gram", installPath: "bin/gram", onPath: true },
  {
    platform: "win32",
    editor: "positron",
    installPath: "bin/positron.exe",
    onPath: true,
  },
  { platform: "win32", editor: "gram", installPath: "bin/gram.exe", onPath: true },
] as const) {
  for (const target of ["/workspace with spaces", "/workspace with spaces/file.R:12:4"]) {
    it.effect.skipIf(windowsHost)(
      `discovers and opens ${editor} on ${platform}: ${target}`,
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-editors-" });
          const executable = path.join(home, installPath);
          yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
          yield* fs.writeFileString(executable, "#!/bin/sh\n");
          yield* fs.chmod(executable, 0o755);

          const spawned: ChildProcess.StandardCommand[] = [];
          const spawner = Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.make((command) =>
              Effect.sync(() => {
                assert.ok(ChildProcess.isStandardCommand(command));
                if (!ChildProcess.isStandardCommand(command)) throw new Error("Expected command");
                spawned.push(command);
                return ChildProcessSpawner.makeHandle({
                  pid: ChildProcessSpawner.ProcessId(1),
                  exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
                  isRunning: Effect.succeed(true),
                  kill: () => Effect.void,
                  unref: Effect.succeed(Effect.void),
                  stdin: Sink.drain,
                  stdout: Stream.empty,
                  stderr: Stream.empty,
                  all: Stream.empty,
                  getInputFd: () => Sink.drain,
                  getOutputFd: () => Stream.empty,
                });
              }),
            ),
          );

          yield* Effect.gen(function* () {
            const launcher = yield* ExternalLauncher.ExternalLauncher;
            assert.include(yield* launcher.resolveAvailableEditors(), editor);
            yield* launcher.launchEditor({ editor, cwd: target });
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawner))),
                Layer.succeed(HostProcess.Platform, platform),
                Layer.succeed(SpawnExecutableResolution, () => executable),
                ConfigProvider.layer(
                  ConfigProvider.fromEnv({
                    env: {
                      HOME: home,
                      LOCALAPPDATA: home,
                      PATH: path.join(home, onPath ? "bin" : "empty"),
                      PATHEXT: ".EXE;.CMD",
                    },
                  }),
                ),
              ),
            ),
          );

          // Headless Linux also probes the graphical session through busctl.
          const launches = spawned.filter((command) => command.command !== "busctl");
          assert.lengthOf(launches, 1);
          // POSIX spawns preserve the PATH command; Windows resolves its extension first.
          assert.equal(launches[0]?.command, platform === "linux" && onPath ? editor : executable);
          assert.deepEqual(
            launches[0]?.args,
            editor === "positron" && target.endsWith(":12:4") ? ["--goto", target] : [target],
          );
          assert.equal(launches[0]?.options.detached, true);
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
}
