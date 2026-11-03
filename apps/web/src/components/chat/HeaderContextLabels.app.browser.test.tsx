import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ProviderInstanceId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { ENVIRONMENT_ID, installFakeEnvironment, threadWithHistory, type FakeDriver } from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";
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
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("shows the active environment and reacts to a composer model choice in the complete client", async () => {
  const thread = threadWithHistory("header-context-app", 1);
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" });
  await page.viewport(1280, 800);
  const router = getRouter(createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }));
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  await document.fonts.ready;
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE === "before") {
    await app.locator.screenshot({ path: "../../../../../.t3/header-evidence/before-client.png" });
    return;
  }
  const header = app.container.querySelector("[data-chat-header]");
  expect(header?.querySelector("[data-header-machine]")).not.toBeNull();
  expect(header?.querySelector("[data-header-model]")?.textContent).toContain("GPT-5.4");
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
    await app.locator.screenshot({ path: "../../../../../.t3/header-evidence/after-client.png" });
  }
  await act(() => useComposerDraftStore.getState().setModelSelection(
    scopeThreadRef(ENVIRONMENT_ID, thread.id),
    { instanceId: ProviderInstanceId.make("codex"), model: "custom-model-choice" },
  ));
  await vi.waitFor(() => expect(header?.querySelector("[data-header-model]")?.textContent).toContain("custom-model-choice"));
});
