import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { type Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";

const state = vi.hoisted(() => ({
  threads: [] as EnvironmentThreadShell[],
  configAtom: null as unknown as Atom.Writable<ServerConfig | null>,
  cacheWarmingSessions: {} as Record<string, boolean>,
  update: vi.fn(),
  environmentId: "" as EnvironmentId,
}));

vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  state.configAtom = Atom.make<ServerConfig | null>(null).pipe(Atom.keepAlive);
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      configValueAtom: (() => state.configAtom) as never,
    },
  };
});
vi.mock(import("../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((
    _envId: unknown,
    selector: (s: { cacheWarmingSessions: Record<string, boolean> }) => unknown,
  ) => selector({ cacheWarmingSessions: state.cacheWarmingSessions })) as never,
  useUpdateEnvironmentSettings: (() => state.update) as never,
}));
vi.mock(import("../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: ((id: EnvironmentId) => ({ environmentId: id, label: "GWDG HPC" })) as never,
  usePrimaryEnvironmentId: (() => state.environmentId) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useThreadShells: (() => state.threads) as never,
}));
vi.mock(import("../hooks/useThreadRouteTarget"), async (original) => ({
  ...(await original()),
  useThreadRouteTarget: (() => null) as never,
}));

import { SidebarCacheWarmingToggle } from "./CacheWarmingToggle";

function makeServerConfig(options: {
  readonly codexCacheWarmAfter?: boolean;
  readonly codexCacheWarmAfterMinutes: number;
}): ServerConfig {
  return {
    environment: {
      environmentId: state.environmentId,
      label: "GWDG HPC",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.0.0",
      capabilities:
        options.codexCacheWarmAfter === undefined
          ? {}
          : { codexCacheWarmAfter: options.codexCacheWarmAfter },
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      codexCacheWarmAfterMinutes: options.codexCacheWarmAfterMinutes,
      cacheWarmingSessions: state.cacheWarmingSessions,
    },
  } as unknown as ServerConfig;
}

function codexThread(id: string, updatedAt: string): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: state.environmentId,
    archivedAt: null,
    cacheHud: {
      driver: "codex",
      basis: "estimated",
      ttlMs: 3_600_000,
      usage: { usedTokens: 1000, cachedInputTokens: 200, updatedAt },
    },
  } as unknown as EnvironmentThreadShell;
}

describe("CacheWarmingToggle", () => {
  it("falls back to the 55-minute window when the connected server lacks codexCacheWarmAfter", async () => {
    state.environmentId = EnvironmentId.make("gwdg");
    const updatedAt = "2026-10-23T10:00:00Z";
    using _timers = fakeTimers({ now: Date.parse("2026-10-23T11:30:00Z") });
    state.threads = [codexThread("codex-90m", updatedAt)];
    state.cacheWarmingSessions = {};
    state.update.mockReset();

    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    registry.set(state.configAtom, makeServerConfig({ codexCacheWarmAfterMinutes: 115 }));

    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <SidebarCacheWarmingToggle />
      </RegistryContext.Provider>,
    );

    const button = screen.getByRole("button", { name: /warming for all hot conversations/i });
    await expect.element(button).toBeDisabled();

    await act(() => {
      registry.set(
        state.configAtom,
        makeServerConfig({ codexCacheWarmAfter: true, codexCacheWarmAfterMinutes: 115 }),
      );
    });
    await expect.element(button).toBeEnabled();
  });

  it("drops stale eligibility immediately when codexCacheWarmAfterMinutes is reduced while open", async () => {
    state.environmentId = EnvironmentId.make("gwdg");
    const updatedAt = "2026-10-23T14:00:00Z";
    using _timers = fakeTimers({ now: Date.parse(updatedAt) });
    state.threads = [codexThread("codex-open", updatedAt)];
    state.cacheWarmingSessions = {};
    state.update.mockReset();

    const registry = AtomRegistry.make();
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    registry.set(
      state.configAtom,
      makeServerConfig({ codexCacheWarmAfter: true, codexCacheWarmAfterMinutes: 115 }),
    );

    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <SidebarCacheWarmingToggle />
      </RegistryContext.Provider>,
    );

    const button = screen.getByRole("button", { name: /warming for all hot conversations/i });
    await expect.element(button).toBeEnabled();

    await act(() => vi.advanceTimersByTime(90 * 60_000));
    await expect.element(button).toBeEnabled();

    await act(() => {
      registry.set(
        state.configAtom,
        makeServerConfig({ codexCacheWarmAfter: true, codexCacheWarmAfterMinutes: 55 }),
      );
    });
    await expect.element(button).toBeDisabled();
  });
});
