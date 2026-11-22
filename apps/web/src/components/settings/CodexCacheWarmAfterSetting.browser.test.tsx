import { DEFAULT_SERVER_SETTINGS, EnvironmentId, type ServerSettings } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

interface MockEnv {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machineIdlePolicy?: ServerSettings["machineIdlePolicy"];
  readonly codexCacheWarmAfter?: boolean;
  readonly codexCacheWarmAfterMinutes: number;
  readonly neonCacheWarming?: boolean;
  readonly neonCacheWarmAfterMinutes?: number;
}

const state = vi.hoisted(() => ({
  environments: [] as MockEnv[],
  update: vi.fn(),
}));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useOptionalSettingsScope: (() => ({})) as never,
  useSettingsScope: (() => {
    const connectedEnvironments = state.environments.map((env) => ({
      environmentId: env.environmentId,
      label: env.label,
      serverConfig: {
        environment: {
          capabilities: {
            machineIdlePolicy: env.machineIdlePolicy !== undefined,
            codexCacheWarmAfter: env.codexCacheWarmAfter,
            neonCacheWarming: env.neonCacheWarming,
          },
        },
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          ...(env.machineIdlePolicy === undefined
            ? {}
            : { machineIdlePolicy: env.machineIdlePolicy }),
          codexCacheWarmAfterMinutes: env.codexCacheWarmAfterMinutes,
          neonCacheWarmAfterMinutes: env.neonCacheWarmAfterMinutes ?? 50,
        } satisfies ServerSettings,
      },
    }));
    const targets = connectedEnvironments.map((env) => ({
      environmentId: env.environmentId,
      settings: env.serverConfig.settings,
    }));
    return {
      scope: { kind: "all" },
      environments: connectedEnvironments,
      connectedEnvironments,
      targets,
      target: targets[0] ?? null,
    };
  }) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() =>
    state.environments[0]
      ? {
          ...DEFAULT_SERVER_SETTINGS,
          codexCacheWarmAfterMinutes: state.environments[0].codexCacheWarmAfterMinutes,
        }
      : DEFAULT_SERVER_SETTINGS) as never,
  useScopedSettingsWriteAllowed: () => true,
  useUpdateScopedSettings: (() => state.update) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({
    title,
    mixed,
    status,
    resetAction,
    control,
  }: {
    title?: ReactNode;
    mixed?: boolean;
    status?: ReactNode;
    resetAction?: ReactNode;
    control?: ReactNode;
  }) => (
    <div data-testid="codex-warm-row" data-mixed={String(Boolean(mixed))}>
      {title}
      {status ? <div data-testid="codex-warm-status">{status}</div> : null}
      {resetAction ? <div data-testid="codex-warm-reset">{resetAction}</div> : null}
      {control}
    </div>
  ),
  SettingResetButton: ({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) => (
    <button type="button" aria-label={ariaLabel} onClick={onClick}>
      Reset
    </button>
  ),
}));

import {
  CacheWarmAfterSettings,
  CodexCacheWarmAfterSetting,
  NeonCacheWarmAfterSetting,
} from "./CodexCacheWarmAfterSetting";
import { MachineIdleSettings } from "./MachineIdleSettings";

describe("CodexCacheWarmAfterSetting", () => {
  it("shows 55 min, disables changes, and explains the upgrade on legacy servers", async () => {
    state.update.mockReset();
    state.environments = [
      {
        environmentId: EnvironmentId.make("gwdg"),
        label: "GWDG HPC",
        codexCacheWarmAfterMinutes: 115,
      },
    ];

    await using screen = await render(<CodexCacheWarmAfterSetting />);
    const trigger = screen.getByRole("combobox", { name: "Warm Codex after" });
    await expect
      .element(screen.getByTestId("codex-warm-row"))
      .toHaveAttribute("data-mixed", "false");
    await expect.element(trigger).toHaveTextContent("55 min (previous default)");
    await expect.element(trigger).toBeDisabled();
    await expect
      .element(screen.getByTestId("codex-warm-status"))
      .toHaveTextContent(
        "Upgrade T3 Code on GWDG HPC to change this setting; older servers still warm Codex after 55 minutes.",
      );
    await expect.element(screen.getByTestId("codex-warm-reset")).not.toBeInTheDocument();
  });

  it("shows Mixed and disables edits when an upgraded server is paired with an older server", async () => {
    state.update.mockReset();
    state.environments = [
      {
        environmentId: EnvironmentId.make("mac"),
        label: "Mac",
        codexCacheWarmAfter: true,
        codexCacheWarmAfterMinutes: 115,
      },
      {
        environmentId: EnvironmentId.make("gwdg"),
        label: "GWDG HPC",
        codexCacheWarmAfterMinutes: 115,
      },
    ];

    await using screen = await render(<CodexCacheWarmAfterSetting />);
    const trigger = screen.getByRole("combobox", { name: "Warm Codex after" });
    await expect
      .element(screen.getByTestId("codex-warm-row"))
      .toHaveAttribute("data-mixed", "true");
    await expect.element(trigger).toHaveTextContent("Mixed");
    await expect.element(trigger).toBeDisabled();
    await expect
      .element(screen.getByTestId("codex-warm-status"))
      .toHaveTextContent(
        "Upgrade T3 Code on GWDG HPC to change this setting; older servers still warm Codex after 55 minutes.",
      );
  });

  it("allows editing and resetting when all connected servers support codexCacheWarmAfter", async () => {
    state.update.mockReset();
    state.environments = [
      {
        environmentId: EnvironmentId.make("mac"),
        label: "Mac",
        codexCacheWarmAfter: true,
        codexCacheWarmAfterMinutes: 85,
      },
    ];

    await using screen = await render(<CodexCacheWarmAfterSetting />);
    const trigger = screen.getByRole("combobox", { name: "Warm Codex after" });
    await expect.element(trigger).toHaveTextContent("1 h 25 min");
    await expect.element(trigger).toBeEnabled();
    await expect.element(screen.getByTestId("codex-warm-status")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Reset Codex warm time to default" }).click();
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ codexCacheWarmAfterMinutes: 115 });
  });
});

it.each([false, true])(
  "only changes the Neon interval on an upgraded server (%s)",
  async (supported) => {
    state.update.mockReset();
    state.environments = [
      {
        environmentId: EnvironmentId.make("mac"),
        label: "Mac",
        codexCacheWarmAfterMinutes: 115,
        neonCacheWarmAfterMinutes: 40,
        neonCacheWarming: supported,
      },
    ];

    await using screen = await render(<NeonCacheWarmAfterSetting />);
    const trigger = screen.getByRole("combobox", { name: "Warm Neon after" });
    if (!supported) {
      await expect.element(trigger).toBeDisabled();
      await expect
        .element(screen.getByTestId("codex-warm-status"))
        .toHaveTextContent("Upgrade T3 Code on Mac to warm Neon.");
      return;
    }
    await expect.element(trigger).toHaveTextContent("40 min");
    await screen.getByRole("button", { name: "Reset Neon warm time to default" }).click();
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ neonCacheWarmAfterMinutes: 50 });
  },
);

it("edits a provider cutoff in thousands of tokens on the selected machine", async () => {
  state.update.mockReset();
  const capture = import.meta.env.VITE_MACHINE_IDLE_CAPTURE === "1";
  if (capture) {
    state.environments = [
      {
        environmentId: EnvironmentId.make("mac"),
        label: "Mac",
        codexCacheWarmAfter: true,
        codexCacheWarmAfterMinutes: 115,
        neonCacheWarming: true,
        neonCacheWarmAfterMinutes: 50,
      },
    ];
    await using before = await render(<CacheWarmAfterSettings />);
    await expect.element(before.getByRole("combobox", { name: "Warm Codex after" })).toBeVisible();
    await before.locator.screenshot({ path: "../../../../../.t3/idle-policy-evidence/before.png" });
  }
  state.environments = [
    {
      environmentId: EnvironmentId.make("mac"),
      label: "Mac",
      codexCacheWarmAfterMinutes: 115,
      machineIdlePolicy: applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
        machineIdlePolicy: { mode: "compact" },
      }).machineIdlePolicy,
    },
  ];
  await using screen = await render(<MachineIdleSettings />);
  const cutoff = screen.getByRole("spinbutton", { name: "Claude · Minimum context (k tokens)" });
  await expect.element(cutoff).toHaveValue(200);
  if (capture) {
    await screen.locator.screenshot({ path: "../../../../../.t3/idle-policy-evidence/after.png" });
  }
  await userEvent.clear(cutoff);
  await userEvent.type(cutoff, "150");
  await userEvent.keyboard("{Enter}");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    machineIdlePolicy: { claudeAgent: { minContextTokens: 150_000 } },
  });
});
