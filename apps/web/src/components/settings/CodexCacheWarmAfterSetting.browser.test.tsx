import { DEFAULT_SERVER_SETTINGS, EnvironmentId, type ServerSettings } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

interface MockEnv {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly codexCacheWarmAfter?: boolean;
  readonly codexCacheWarmAfterMinutes: number;
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
          capabilities:
            env.codexCacheWarmAfter === undefined
              ? {}
              : { codexCacheWarmAfter: env.codexCacheWarmAfter },
        },
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          codexCacheWarmAfterMinutes: env.codexCacheWarmAfterMinutes,
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
  useUpdateScopedSettings: (() => state.update) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({
    mixed,
    status,
    resetAction,
    control,
  }: {
    mixed?: boolean;
    status?: ReactNode;
    resetAction?: ReactNode;
    control?: ReactNode;
  }) => (
    <div data-testid="codex-warm-row" data-mixed={String(Boolean(mixed))}>
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

import { CodexCacheWarmAfterSetting } from "./CodexCacheWarmAfterSetting";

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
    await expect.element(screen.getByTestId("codex-warm-status")).toHaveTextContent(/GWDG HPC/);
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
