import type * as Context from "effect/Context";
import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { ENVIRONMENT_ID, installFakeEnvironment, threadWithHistory, type FakeDriver } from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import "../../index.css";

vi.mock("../../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()), trackRpcRequestSent: () => {},
}));
vi.mock(import("~/lib/t3ProjectFileDefaults"), async (original) => ({
  ...(await original()), readT3ProjectFile: async () => null,
}));

it("filters Working through the existing menu, preserves project scope, and moves Working above Main", async () => {
  localStorage.removeItem("t3code:sidebar-working-only");
  localStorage.removeItem("t3code:sidebar-working-first");
  const idle = threadWithHistory("idle-view", 1);
  const working = { ...threadWithHistory("working-view", 1), status: "running" as const };
  using _environment = installFakeEnvironment([idle, working]);
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, sidebarWorkingShelfEnabled: true, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" });
  await page.viewport(1280, 850);
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${idle.id}`] }));
  await router.load();
  await using app = await render(<AppRoot router={router} />, { router: false });
  const row = (title: string) => page.getByTestId("sidebar-row-card").filter({ hasText: title });
  await expect.element(row(idle.title)).toBeVisible();
  const capture = async (name: string) => {
    if (import.meta.env.VITE_WORKING_CAPTURE) await app.locator.screenshot({ path: `../../../../../.t3/working-sidebar-evidence/${name}.png` });
  };
  await capture("before");
  await userEvent.click(page.getByRole("button", { name: /^Filter threads by project or machine/ }));
  const workingCheckbox = page.getByRole("checkbox", { name: "Working only" });
  workingCheckbox.element().focus();
  await expect.element(workingCheckbox).toBeFocused();
  await userEvent.keyboard(" ");
  await expect.element(workingCheckbox).toBeChecked();
  await expect.element(page.getByTestId("sidebar-filter-active")).toBeInTheDocument();
  await capture("working-filter-menu");
  await userEvent.keyboard("{Escape}");
  await expect.element(row(idle.title)).not.toBeInTheDocument();
  await expect.element(row(working.title)).toBeVisible();
  await capture("working-only");
  await userEvent.fill(page.getByRole("combobox", { name: "Search threads" }), "idle-view");
  await expect.element(page.getByRole("option", { name: /Thread idle-view/ })).not.toBeInTheDocument();
  await userEvent.fill(page.getByRole("combobox", { name: "Search threads" }), "");
  await userEvent.click(page.getByRole("button", { name: /^Filter threads by project or machine/ }));
  await userEvent.click(page.getByRole("checkbox", { name: "Working only" }));
  await userEvent.click(page.getByRole("option", { name: /^render/ }));
  await expect.element(page.getByTestId("sidebar-filter-active")).toBeInTheDocument();
  await expect.element(row(idle.title)).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: /^Filter threads by project or machine/ }));
  await userEvent.click(page.getByRole("option", { name: /^All projects/ }));
  await expect.element(page.getByTestId("sidebar-filter-active")).not.toBeInTheDocument();
  await expect.element(row(working.title)).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Sort conversations" }));
  await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Show Working above main list" }));
  await expect.element(page.getByRole("button", { name: "Sort conversations" })).toBeVisible();
  await vi.waitFor(() => expect(page.getByTestId("sidebar-working-header").element().compareDocumentPosition(row(idle.title).element()) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0));
  await capture("working-first");
});
