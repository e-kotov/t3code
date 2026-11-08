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
import { act, render } from "../../../test/render";
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
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  useProjectFileQuery: () => ({
    data: {
      relativePath: "/outside/review-2.qmd",
      contents: "Second-round review\nThank you for the improvements.\n",
      byteLength: 55,
      truncated: false,
    },
    error: null,
    isPending: false,
    readError: null,
    isNotFile: false,
    isFile: true,
    refresh: () => {},
  }),
}));

it("opens an external review from chat and shows its comment form in the complete client", async () => {
  const history = threadWithHistory("external-review-app", 1);
  const thread = {
    ...history,
    items: history.items.map((item) =>
      item.type === "assistant_message"
        ? { ...item, text: "Open [review-2.qmd](/outside/review-2.qmd)." }
        : item,
    ),
  };
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1440, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await userEvent.click(app.getByRole("link", { name: "review-2.qmd" }));
  const line = () =>
    app.container
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>('[data-column-number="2"]');
  await vi.waitFor(() => expect(line()).toBeTruthy());
  await document.fonts.ready;
  if (import.meta.env.VITE_SOURCE_COMMENTS_CAPTURE === "before") {
    await app.locator.screenshot({
      path: "../../../../../.t3/source-comments-evidence/before-client.png",
    });
    return;
  }
  const row = line()!;
  const rect = row.getBoundingClientRect();
  await act(() => {
    const options = {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
    row.dispatchEvent(new PointerEvent("pointerdown", options));
    document.dispatchEvent(new PointerEvent("pointerup", options));
  });
  const input = app.getByRole("textbox", { name: "Comment on lines L2" });
  await expect.element(input).toBeVisible();
  await input.fill("Please make this thanks more specific.");
  if (import.meta.env.VITE_SOURCE_COMMENTS_CAPTURE) {
    await app.locator.screenshot({
      path: "../../../../../.t3/source-comments-evidence/after-client.png",
    });
  }
});
