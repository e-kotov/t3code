import { createMemoryHistory } from "@tanstack/react-router";
import {
  BearerConnectionTarget,
  type EnvironmentPresentation,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useUiStateStore } from "~/uiStateStore";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import "../index.css";

const machines = vi.hoisted(() => ({ presentations: [] as EnvironmentPresentation[] }));
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));
vi.mock(import("~/state/environments"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironmentIdentities: () => [
      ...actual.useEnvironmentIdentities(),
      ...machines.presentations.map((p) => ({
        environmentId: p.entry.target.environmentId,
        label: p.entry.target.label,
      })),
    ],
    useEnvironments: () => {
      const state = actual.useEnvironments();
      return {
        ...state,
        environments: [
          ...state.environments,
          ...machines.presentations.map((p) => ({
            ...p,
            environmentId: p.entry.target.environmentId,
            label: p.entry.target.label,
            displayUrl: null,
            relayManaged: false,
          })),
        ],
      };
    },
  };
});
vi.mock(import("~/state/presentation"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironmentPresentation: (id: EnvironmentId | null) => {
      const state = actual.useEnvironmentPresentation(id);
      return {
        ...state,
        presentation:
          machines.presentations.find((p) => p.entry.target.environmentId === id) ??
          state.presentation,
      };
    },
  };
});

const GWDG = EnvironmentId.make("filter-gwdg");
const HUB = EnvironmentId.make("filter-hub");
function machine(
  id: EnvironmentId,
  label: string,
  phase: EnvironmentConnectionPhase,
): EnvironmentPresentation {
  return {
    entry: { target: new BearerConnectionTarget({ environmentId: id, label, connectionId: id }) },
    connection: { phase, error: null, traceId: null },
    serverConfig: {
      newProjectsRoot: "/workspace",
      environment: { platform: { machine: "server" }, capabilities: {} },
      settings: {},
      slurmJobStatus: {
        jobId: "16627419",
        state: "running",
        remainingSeconds: 5400,
        observedAt: 0,
        serverNow: 0,
      },
    },
  } as EnvironmentPresentation;
}

async function mount() {
  const stack = new AsyncDisposableStack();
  try {
    const thread = threadWithHistory("machine-filters", 1);
    stack.use(installFakeEnvironment([thread]));
    machines.presentations = [
      machine(GWDG, "GWDG", "reconnecting"),
      machine(HUB, "hub", "connected"),
    ];
    useUiStateStore.setState({ sidebarEnvironmentScopeId: null, sidebarProjectScopeKeys: [] });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    await page.viewport(1280, 800);
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
    );
    await router.load();
    const app = stack.use(
      await render(<AppRoot router={router} />, {
        // AppRoot owns the production router.
        router: false,
      }),
    );
    await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    return Object.assign(stack.move(), { app });
  } catch (error) {
    await stack.disposeAsync();
    throw error;
  }
}

it("toggles machine filters with Shift-click and Shift+Enter without closing the picker", async () => {
  await using screen = await mount();
  await userEvent.click(
    screen.app.getByRole("combobox", { name: /^Filter threads by project or machine/ }),
  );
  const gwdg = page.getByRole("option", { name: /GWDG/ });
  const hub = page.getByRole("option", { name: /hub/ });
  const capture = import.meta.env.VITE_MACHINE_FILTER_CAPTURE;
  if (capture === "before") {
    await page
      .getByRole("listbox")
      .screenshot({ path: "../../../../.t3/machine-filter-evidence/before-filter.png" });
    return;
  }
  await expect.element(gwdg.getByRole("button", { name: "GWDG is reconnecting" })).toBeVisible();
  expect(gwdg.element().querySelector(".motion-safe\\:animate-status-ping")).not.toBeNull();
  await userEvent.click(gwdg, { modifiers: ["Shift"] });
  await userEvent.click(hub, { modifiers: ["Shift"] });
  await expect.element(gwdg).toHaveAttribute("aria-selected", "true");
  await expect.element(hub).toHaveAttribute("aria-selected", "true");
  expect(useUiStateStore.getState().sidebarEnvironmentScopeId).toEqual([GWDG, HUB]);
  if (capture)
    await page
      .getByRole("listbox")
      .screenshot({ path: "../../../../.t3/machine-filter-evidence/after-filter.png" });
  const search = page.getByRole("combobox", { name: "Search projects or machines" });
  await search.fill("GWDG");
  await userEvent.keyboard("{ArrowDown}{Shift>}{Enter}{/Shift}");
  await expect.element(gwdg).toHaveAttribute("aria-selected", "false");
  expect(useUiStateStore.getState().sidebarEnvironmentScopeId).toBe(HUB);
  await search.fill("");
  await userEvent.click(page.getByRole("option", { name: /All machines/ }));
  expect(useUiStateStore.getState().sidebarEnvironmentScopeId).toBeNull();
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
});

it("shows reconnecting machines and Slurm time remaining when adding a project", async () => {
  await using screen = await mount();
  await userEvent.click(screen.app.getByRole("button", { name: "Add project", exact: true }));
  const gwdg = page.getByRole("option", { name: /GWDG/ });
  const capture = import.meta.env.VITE_MACHINE_FILTER_CAPTURE;
  if (capture === "before") {
    await page
      .getByRole("dialog")
      .screenshot({ path: "../../../../.t3/machine-filter-evidence/before-project-picker.png" });
    return;
  }
  await expect.element(gwdg).toHaveAttribute("aria-disabled", "true");
  await expect.element(gwdg.getByRole("button", { name: "GWDG is reconnecting" })).toBeVisible();
  await expect.element(page.getByRole("option", { name: /hub/ }).getByText("1h30m")).toBeVisible();
  if (capture)
    await page
      .getByRole("dialog")
      .screenshot({ path: "../../../../.t3/machine-filter-evidence/after-project-picker.png" });
});
