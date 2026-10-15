import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ExternalLauncher from "./externalLauncher.ts";

it.effect("launches a custom executable with literal arguments through the existing launcher", () => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "custom-editor-" });
  const executable = path.join(directory, "my editor");
  yield* fs.writeFileString(executable, "#!/bin/sh\nexit 0\n");
  yield* fs.chmod(executable, 0o755);
  let spawned: ChildProcess.StandardCommand | undefined;
  let unreferenced = false;
  const spawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make((command) => Effect.sync(() => {
    assert.ok(ChildProcess.isStandardCommand(command));
    if (!ChildProcess.isStandardCommand(command)) throw new Error("Expected a standard command");
    spawned = command;
    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      isRunning: Effect.succeed(true), kill: () => Effect.void,
      unref: Effect.sync(() => { unreferenced = true; return Effect.void; }),
      stdin: Sink.drain, stdout: Stream.empty, stderr: Stream.empty, all: Stream.empty,
      getInputFd: () => Sink.drain, getOutputFd: () => Stream.empty,
    });
  })));
  yield* Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    yield* launcher.launchEditor({ cwd: '/my project/"$(never-run).ts:12:4', editor: "custom", customEditor: { name: "My editor", command: executable, args: ["--goto", "{path}:{line}:{column}"] } });
  }).pipe(Effect.provide(Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawner))),
    Layer.succeed(HostProcess.Platform, "linux"),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
  )));
  assert.ok(spawned);
  assert.equal(spawned.command, executable);
  assert.deepEqual(spawned.args, ["--goto", '/my project/"$(never-run).ts:12:4']);
  assert.equal(spawned.options.shell, false);
  assert.equal(unreferenced, true);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
