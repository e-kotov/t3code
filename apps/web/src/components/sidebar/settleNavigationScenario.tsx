import { createMemoryHistory } from "@tanstack/react-router";
import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { composerDraftHasUserContent, useComposerDraftStore } from "~/composerDraftStore";
import { useThreadUndoNotice } from "~/hooks/showThreadUndoNotice";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  dispatchedCommands,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  PROJECT_ID,
  threadWithHistory,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import "../../index.css";

const ELEMENT_WAIT = { timeout: 5_000 };

export async function runSettleNavigationScenario(
  choice: ClientSettings["settleNavigation"] | undefined,
  destination: "next" | "new-chat" | "settled",
) {
  useThreadUndoNotice.setState({ notice: null });
  const open = threadWithHistory(`${destination}-open`, 1);
  const next = threadWithHistory(`${destination}-next`, 1);
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
  await expect.element(page.getByText(`${open.id}: question 0`), ELEMENT_WAIT).toBeVisible();
  await expect.element(page.getByText(`Thread ${next.id}`).first(), ELEMENT_WAIT).toBeVisible();

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
    await expect.element(page.getByText(`${next.id}: question 0`), ELEMENT_WAIT).toBeVisible();
    // Opening the next thread is what marks it read.
    await vi.waitFor(() => expect(commandsFor("thread.visit", next.id)).not.toHaveLength(0));
  } else {
    if (destination === "settled") {
      expect(router.history.location.pathname).toBe(openPath);
      await expect.element(page.getByText(`${open.id}: question 0`), ELEMENT_WAIT).toBeVisible();
    } else {
      await vi.waitFor(() => expect(router.history.location.pathname).toMatch(/^\/draft\//));
      await expect.element(page.getByTestId("composer-editor"), ELEMENT_WAIT).toBeVisible();
      const drafts = useComposerDraftStore.getState();
      const draft = drafts.getDraftSessionByProjectRef({
        environmentId: ENVIRONMENT_ID,
        projectId: PROJECT_ID,
      });
      expect(router.history.location.pathname).toBe(`/draft/${draft?.draftId}`);
      const composerDraft = draft ? drafts.getComposerDraft(draft.draftId) : null;
      expect(draft).not.toBeNull();
      expect(composerDraftHasUserContent(composerDraft)).toBe(false);
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
      await expect.element(row, ELEMENT_WAIT).toBeVisible();
      await app.locator.screenshot({
        path: "../../../../../.t3/settle-evidence/settings.png",
      });
    }
  }
}
