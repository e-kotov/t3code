import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import "../../index.css";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("shows the machine's slurm countdown in the header and the filter menu", async () => {
  const thread = threadWithHistory("header-machine-slurm", 1);
  using _environment = installFakeEnvironment([thread], {
    slurmJobStatus: {
      jobId: "16627419",
      state: "running",
      remainingSeconds: 5400,
      observedAt: 0,
      serverNow: 0,
    },
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1280, 800);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  const capture = import.meta.env.VITE_SLURM_CAPTURE as string | undefined;
  if (capture === "before") {
    expect(app.container.querySelector("[data-header-machine]")?.textContent).not.toContain(
      "1h30m",
    );
    await app.locator.screenshot({
      path: "../../../../../.t3/slurm-evidence/before-header.png",
    });
    await userEvent.click(
      app.getByRole("combobox", { name: /^Filter threads by project or machine/ }),
    );
    await expect.element(page.getByRole("option", { name: /Render scenarios/ })).toBeVisible();
    const machineOption = page.getByRole("option", { name: /Render scenarios/ });
    expect(machineOption.element().textContent).not.toContain("1h30m");
    await machineOption.screenshot({
      path: "../../../../../.t3/slurm-evidence/before-filter.png",
    });
    return;
  }
  await vi.waitFor(() => {
    const machine = app.container.querySelector("[data-header-machine]");
    expect(machine?.textContent).toContain("1h30m");
  });
  await userEvent.click(
    app.getByRole("combobox", { name: /^Filter threads by project or machine/ }),
  );
  const machineOption = page.getByRole("option", { name: /Render scenarios/ });
  await expect.element(machineOption).toBeVisible();
  await vi.waitFor(() => {
    expect(machineOption.element().textContent).toContain("1h30m");
  });
  if (capture) {
    await app.locator.screenshot({
      path: "../../../../../.t3/slurm-evidence/after-header.png",
    });
    await machineOption.screenshot({
      path: "../../../../../.t3/slurm-evidence/after-filter.png",
    });
  }
});
