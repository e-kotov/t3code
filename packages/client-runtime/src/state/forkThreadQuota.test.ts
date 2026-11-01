import { EnvironmentId, ThreadId, type ForkThreadQuota } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { minuteTick } from "../clock.ts";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { layerRemoteHttpClient } from "../rpc/http.ts";

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({
    preparedConnectionValueAtom: () => preparedAtom,
  }),
}));

import { createForkThreadQuotaAtoms } from "./forkThreadQuota.ts";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const prepared: PreparedConnection = {
  environmentId,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target: new PrimaryConnectionTarget({
    environmentId,
    label: "Test environment",
    httpBaseUrl: "https://environment.example.test",
    wsBaseUrl: "wss://environment.example.test/ws",
  }),
};
const preparedAtom = Atom.make<Option.Option<PreparedConnection>>(Option.some(prepared));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(delayMs: number, connected = true) {
  vi.useFakeTimers({ now: Date.parse("2026-01-01T00:00:01Z") });
  const subscribe = minuteTick.subscribe;
  let tickCallbacks = 0;
  vi.spyOn(minuteTick, "subscribe").mockImplementation((listener) =>
    subscribe(() => {
      // Bound the old synchronous loop so a regression fails instead of hanging CI.
      if (++tickCallbacks > 8) throw new Error("Minute refresh resubscribed without yielding");
      listener();
    }),
  );
  let reading: ForkThreadQuota = {
    status: "unavailable",
    checkedAt: "2026-01-01T00:00:00Z",
    dataAsOf: null,
    fiveHourPercent: null,
    weeklyPercent: null,
    balanceCredits: null,
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const response = Response.json(reading);
    if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return response;
  });
  const runtime = Atom.runtime(
    Layer.mergeAll(Layer.mock(EnvironmentRegistry)({}), layerRemoteHttpClient(fetch)),
  );
  const family = createForkThreadQuotaAtoms(runtime);
  const atom = family(JSON.stringify([environmentId, threadId]));
  const registry = AtomRegistry.make();
  registry.set(preparedAtom, connected ? Option.some(prepared) : Option.none());
  return {
    registry,
    atom,
    fetch,
    value: () => AsyncResult.getOrElse(registry.get(atom), () => null),
    setReading: (next: Partial<ForkThreadQuota>) => {
      reading = { ...reading, ...next };
    },
    tickCallbacks: () => tickCallbacks,
  };
}

it.each([0, 50])(
  "refreshes missing and revised readings once per tick with a %i ms request and releases on unmount",
  async (delayMs) => {
    const h = setup(delayMs);
    try {
      const unmountFirst = h.registry.mount(h.atom);
      const unmountSecond = h.registry.mount(h.atom);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.value()?.status).toBe("unavailable");

      h.setReading({ status: "available", weeklyPercent: 1.25 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetch).toHaveBeenCalledTimes(2);
      expect(h.value()?.weeklyPercent).toBe(1.25);

      h.setReading({ weeklyPercent: 2.5 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetch).toHaveBeenCalledTimes(3);
      expect(h.value()?.weeklyPercent).toBe(2.5);

      unmountFirst();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetch).toHaveBeenCalledTimes(4);
      unmountSecond();
      await vi.advanceTimersByTimeAsync(1);
      const callbacks = h.tickCallbacks();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.fetch).toHaveBeenCalledTimes(4);
      expect(h.tickCallbacks()).toBe(callbacks);

      h.setReading({ weeklyPercent: 3.75 });
      const unmountReopened = h.registry.mount(h.atom);
      await vi.advanceTimersByTimeAsync(100);
      expect(h.fetch).toHaveBeenCalledTimes(5);
      expect(h.value()?.weeklyPercent).toBe(3.75);
      unmountReopened();
    } finally {
      h.registry.dispose();
    }
  },
);

it("survives ticks without a prepared connection and reads when it connects", async () => {
  const h = setup(0, false);
  try {
    const unmount = h.registry.mount(h.atom);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetch).not.toHaveBeenCalled();
    h.registry.set(preparedAtom, Option.some(prepared));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.value()?.status).toBe("unavailable");
    unmount();
  } finally {
    h.registry.dispose();
  }
});
