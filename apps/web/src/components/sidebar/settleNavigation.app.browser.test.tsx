import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { useThreadUndoNotice } from "~/hooks/showThreadUndoNotice";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  dispatchedCommands,
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
vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+shift+s", command: "thread.settle", when: "!terminalFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});

it.each([
  ["stays on the settled thread without a saved choice", undefined, "settled"],
  ["opens the next thread when chosen", "next-thread", "next"],
  ["opens a new chat in the same project when chosen", "new-chat", "new-chat"],
] as const)("%s", async (_name, choice, destination) => {
  useThreadUndoNotice.setState({ notice: null });
  const [open, next] = [threadWithHistory("settle-open", 1), threadWithHistory("settle-next", 1)];
  using _environment = installFakeEnvironment([open, next], { acceptCommands: true });
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    ...(choice === undefined ? {} : { settleNavigation: choice }),
  });
  await page.viewport(1280, 800);
  const openPath = `/${ENVIRONMENT_ID}/${open.id}`;
  const router = getRouter(createMemoryHistory({ initialEntries: [openPath] }));
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByText("settle-open: question 0")).toBeVisible();
  await expect.element(page.getByText(`Thread ${next.id}`).first()).toBeVisible();

  await userEvent.keyboard("{Control>}{Shift>}S{/Shift}{/Control}");
  await vi.waitFor(() => expect(useThreadUndoNotice.getState().notice?.action).toBe("Settled"));
  const commandsFor = (type: string, threadId: string) =>
    dispatchedCommands().filter(
      (command) => command.type === type && "threadId" in command && command.threadId === threadId,
    );
  expect(commandsFor("thread.settle", open.id)).toHaveLength(1);

  if (destination === "next") {
    await vi.waitFor(() =>
      expect(router.history.location.pathname).toBe(`/${ENVIRONMENT_ID}/${next.id}`),
    );
    await expect.element(page.getByText("settle-next: question 0")).toBeVisible();
    // Opening the next thread is what marks it read.
    await vi.waitFor(() => expect(commandsFor("thread.visit", next.id)).not.toHaveLength(0));
  } else {
    if (destination === "settled") {
      expect(router.history.location.pathname).toBe(openPath);
      await expect.element(page.getByText("settle-open: question 0")).toBeVisible();
    } else {
      await vi.waitFor(() => expect(router.history.location.pathname).toMatch(/^\/draft\//));
      await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    }
    expect(commandsFor("thread.visit", next.id)).toEqual([]);
    expect(
      dispatchedCommands()
        .map((command) => command.type)
        .filter((type) => type !== "thread.visit"),
    ).toEqual(["thread.settle"]);
  }

  const capture = import.meta.env.VITE_SETTLE_CAPTURE as string | undefined;
  if (capture) {
    await app.locator.screenshot({
      path: `../../../../../.t3/settle-evidence/${destination}.png`,
    });
    if (destination === "settled") {
      await router.navigate({ to: "/settings/general" });
      const row = page.getByText("After settling the open thread");
      await expect.element(row).toBeVisible();
      await app.locator.screenshot({
        path: "../../../../../.t3/settle-evidence/settings.png",
      });
    }
  }
});
