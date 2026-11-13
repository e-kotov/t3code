import { asLaunchingThread } from "@t3tools/client-runtime/state/thread-inbox";
import type * as Context from "effect/Context";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
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
vi.mock(import("~/lib/t3ProjectFileDefaults"), async (original) => ({
  ...(await original()),
  readT3ProjectFile: async () => null,
}));
// Supply pin placement and a launching thread at the shell fixture boundary.
vi.mock(import("~/state/entities"), async (original) => {
  const actual = await original();
  const { useMemo } = await import("react");
  return {
    ...actual,
    useQuietThreadShells: () => {
      const threads = actual.useQuietThreadShells();
      return useMemo(
        () =>
          threads.map((thread) => {
            if (thread.id === "pinned-fold") {
              return { ...thread, pinnedAt: thread.createdAt, pinOrderKey: "a" };
            }
            if (thread.id === "working-fold") return asLaunchingThread(thread);
            return thread;
          }),
        [threads],
      );
    },
  };
});

it("folds pinned, unpinned and Working machine sections through their own buttons", async () => {
  localStorage.setItem("t3code:sidebar:working-expanded", "true");
  const pin = threadWithHistory("pinned-fold", 1);
  const main = threadWithHistory("unpinned-fold", 1);
  const working = threadWithHistory("working-fold", 0);
  const open = threadWithHistory("open-fold", 1);
  using _environment = installFakeEnvironment([pin, main, working, open]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarConversationGrouping: "machine",
    sidebarWorkingShelfEnabled: true,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1280, 850);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${open.id}`] }),
  );
  await router.load();
  // AppRoot owns the production router.
  await using app = await render(<AppRoot router={router} />, { router: false });
  const row = (title: string) => page.getByTestId("sidebar-row-card").filter({ hasText: title });
  for (const thread of [pin, main, working, open])
    await expect.element(row(thread.title)).toBeVisible();
  const capture = async (name: string) => {
    if (import.meta.env.VITE_MACHINE_FOLD_CAPTURE)
      await app.locator.screenshot({
        path: `../../../../../.t3/machine-fold-evidence/${name}.png`,
      });
  };
  await capture(`${import.meta.env.VITE_MACHINE_FOLD_CAPTURE}-expanded`);
  if (import.meta.env.VITE_MACHINE_FOLD_CAPTURE === "before") return;
  const buttons = page.getByRole("button", { name: /^Collapse .* machine group$/ });
  const pinFold = buttons.nth(0);
  const pinHeader = pinFold.element().parentElement!.parentElement!;
  expect(pinHeader.querySelector('[aria-label="Pinned"]')).not.toBeNull();
  const arrows = pinHeader.querySelectorAll("button");
  expect(arrows[arrows.length - 1]).toBe(pinFold.element());
  await userEvent.click(pinFold);
  await expect.element(row(pin.title)).not.toBeInTheDocument();
  await expect.element(row(main.title)).toBeVisible();
  await expect.element(row(working.title)).toBeVisible();
  await capture("after-pinned-folded");
  await userEvent.click(buttons.nth(0));
  await expect.element(row(main.title)).not.toBeInTheDocument();
  await expect.element(row(open.title)).toBeVisible();
  await expect.element(row(working.title)).toBeVisible();
  await userEvent.click(buttons.nth(0));
  await expect.element(row(working.title)).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: /^Expand .* machine group$/ }).nth(0));
  await expect.element(row(pin.title)).toBeVisible();
  await expect.element(row(main.title)).not.toBeInTheDocument();
  await expect.element(row(working.title)).not.toBeInTheDocument();
  await capture("after-only-pinned-expanded");
});
