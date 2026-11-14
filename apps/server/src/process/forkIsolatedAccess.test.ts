// @effect-diagnostics nodeBuiltinImport:off - models helpers stuck in kernel filesystem calls.
import * as NodeEvents from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type MockHelper = NodeEvents.EventEmitter & { kill: ReturnType<typeof vi.fn> };
const state = vi.hoisted(() => ({ helpers: [] as MockHelper[] }));
const helper = (index: number): MockHelper => {
  const found = state.helpers[index];
  if (found === undefined) throw new Error(`Expected helper ${index} to have spawned`);
  return found;
};
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: () =>
    new (class extends NodeEvents.EventEmitter {
      send = vi.fn();
      ref = vi.fn();
      unref = vi.fn();
      // A kernel-blocked helper does not exit when kill() is requested.
      kill = vi.fn(() => true);
      channel = { ref: vi.fn(), unref: vi.fn() };
      constructor() {
        super();
        state.helpers.push(this);
      }
    })(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  state.helpers.length = 0;
});
afterEach(() => {
  for (const helper of state.helpers) helper.emit("exit", 0);
  vi.useRealTimers();
});

it("preserves native errors and reuses healthy helpers", async () => {
  const { access } = await import("./forkIsolatedAccess.ts");
  const first = access("/missing", 1).catch((error) => error);
  helper(0).emit("message", {
    error: {
      message: "missing",
      code: "ENOENT",
      errno: -2,
      syscall: "access",
      path: "/missing",
    },
  });
  expect(await first).toMatchObject({ code: "ENOENT", errno: -2, path: "/missing" });
  const next = access("/local", 1);
  expect(state.helpers).toHaveLength(1);
  helper(0).emit("message", { error: null });
  await next;
});

it("recovers local checks after two hangs without freeing unexited helpers", async () => {
  const { access } = await import("./forkIsolatedAccess.ts");
  const blocked = [access("/mount-a", 1), access("/mount-b", 1)].map((p) => p.catch((e) => e));
  await vi.advanceTimersByTimeAsync(5000);
  for (const result of await Promise.all(blocked)) expect(result.code).toBe("ETIMEDOUT");
  expect(state.helpers.every((w) => w.kill.mock.calls.length === 1)).toBe(true);
  await expect(access("/mount-a", 1)).rejects.toMatchObject({ code: "EAGAIN" });
  const local = access("/local", 1);
  helper(2).emit("message", { error: null });
  await local;
  // The healthy helper can be reused, but two more hangs exhaust the bounded pool.
  const more = [access("/mount-c", 1), access("/mount-d", 1)].map((p) => p.catch((e) => e));
  await vi.advanceTimersByTimeAsync(5000);
  await Promise.all(more);
  await expect(access("/other", 1)).rejects.toMatchObject({ code: "EAGAIN" });
  expect(state.helpers).toHaveLength(4);
  helper(0).emit("exit", 1);
  const recovered = access("/other", 1);
  helper(4).emit("message", { error: null });
  await recovered;
});

it("does not reuse an idle helper after an error", async () => {
  const { access } = await import("./forkIsolatedAccess.ts");
  const first = access("/first", 1);
  helper(0).emit("message", { error: null });
  await first;
  helper(0).emit("error", new Error("helper failed"));
  const next = access("/next", 1);
  expect(state.helpers).toHaveLength(2);
  helper(1).emit("exit", 1);
  await expect(next).rejects.toMatchObject({ code: "EIO" });
});

it("releases a failed-to-start helper on close without requiring exit", async () => {
  const { access, isUnavailable } = await import("./forkIsolatedAccess.ts");
  const failure = access("/first", 1).catch((error) => error);
  helper(0).emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" }));
  expect(isUnavailable(await failure)).toBe(true);
  helper(0).emit("close", -2);
  const next = access("/first", 1);
  helper(1).emit("message", { error: null });
  await next;
});
