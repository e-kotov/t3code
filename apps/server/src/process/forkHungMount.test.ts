// @effect-diagnostics nodeBuiltinImport:off - models uninterruptible helper filesystem calls.
import * as NodeEvents from "node:events";
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Spawner from "effect/process/ChildProcessSpawner";
import * as NonBlocking from "./NonBlockingSpawner.ts";
import { access } from "./forkIsolatedAccess.ts";

const state = vi.hoisted(() => ({
  hung: 0,
  onBoth: () => {},
  helpers: [] as NodeEvents.EventEmitter[],
}));
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: (...args: Parameters<typeof original.spawn>) => {
      if (!Array.isArray(args[1]) || !args[1].includes("__fork-access"))
        return original.spawn(...args);
      return new (class extends NodeEvents.EventEmitter {
        constructor() {
          super();
          state.helpers.push(this);
        }
        ref() {}
        unref() {}
        channel = { ref() {}, unref() {} };
        kill() {
          return true;
        }
        send({ path }: { path: string }) {
          if (path.startsWith("/fork-hung/")) {
            if (++state.hung === 2) state.onBoth();
          } else queueMicrotask(() => this.emit("message", { error: null }));
        }
      })() as ReturnType<typeof original.spawn>;
    },
  };
});

it.live("runs a local command after cancelled mount checks reach their deadline", () =>
  Effect.gen(function* () {
    const both = yield* Deferred.make<void>();
    state.onBoth = () => Deferred.doneUnsafe(both, Effect.void);
    const spawner = yield* Spawner.ChildProcessSpawner;
    const blocked = yield* Effect.forEach(["a", "b"], (name) =>
      spawner
        .exitCode(ChildProcess.make("/bin/true", [], { cwd: `/fork-hung/${name}` }))
        .pipe(Effect.forkChild),
    );
    yield* Deferred.await(both);
    yield* Effect.forEach(blocked, Fiber.interrupt);
    // No 'exit' is emitted for either hung helper: capacity is recovered by isolation,
    // not by pretending kill() interrupted its kernel syscall.
    expect(yield* spawner.exitCode(ChildProcess.make("/bin/true", []))).toBe(0);
    expect(state.helpers).toHaveLength(3);
    yield* Effect.promise(() =>
      Promise.all([
        access("/fork-hung/c", 1).catch((error) => error),
        access("/fork-hung/d", 1).catch((error) => error),
      ]),
    );
    const unavailable = yield* spawner
      .exitCode(ChildProcess.make("/bin/true", []))
      .pipe(Effect.flip);
    expect(unavailable.reason._tag).toBe("Unknown");
    expect(state.helpers).toHaveLength(4);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        for (const helper of state.helpers) helper.emit("exit", 0);
      }),
    ),
    Effect.scoped,
    Effect.provide(NonBlocking.layer.pipe(Layer.provide(NodeServices.layer))),
  ),
);

it.live("exits while a syscall-blocked helper remains alive", () =>
  Effect.gen(function* () {
    const spawner = yield* Spawner.ChildProcessSpawner;
    const script = NodeURL.fileURLToPath(
      new URL("../../../../scripts/fork-process-helper-shutdown.test.py", import.meta.url),
    );
    expect(yield* spawner.exitCode(ChildProcess.make("python3", [script]))).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
