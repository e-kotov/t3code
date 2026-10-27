import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { CompactUsageControl } from "./CompactUsageControl";
import { EnvironmentId, ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import { compactUsageReport } from "./usageCompactReport";

const trigger = () => page.getByRole("button", { name: /^Usage remaining/ });
const details = () => page.getByText("Quota remaining", { exact: true });

function renderControl(openFull: () => void) {
  return render(<CompactUsageControl accounts={[]} onOpenFullView={openFull} />);
}

function account(
  driver: string,
  windows: LimitAccount["limits"]["windows"],
  key = driver,
): LimitAccount {
  return {
    key,
    driver: ProviderDriverKind.make(driver),
    displayName: null,
    email: undefined,
    plan: undefined,
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: "2026-10-26T12:00:00Z", windows },
  };
}

it("shows quota details on hover without opening the full usage page", async () => {
  const openFull = vi.fn();
  await using _screen = await renderControl(openFull);
  await userEvent.hover(trigger());
  await expect.element(details()).toBeVisible();
  await userEvent.hover(details());
  await expect.element(details()).toBeVisible();
  await commands.resetPointer();
  await expect.element(details()).not.toBeInTheDocument();
  expect(openFull).not.toHaveBeenCalled();
});

it("opens the full usage page on the first click", async () => {
  const openFull = vi.fn();
  await using _screen = await renderControl(openFull);
  await userEvent.click(trigger());
  expect(openFull).toHaveBeenCalledOnce();
});

it("keeps composer focus on hover and opens the full page after reading details", async () => {
  const openFull = vi.fn();
  await using screen = await render(
    <>
      <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
      <input aria-label="Composer" />
    </>,
  );
  const composer = screen.getByRole("textbox", { name: "Composer" });
  await userEvent.click(composer);
  await userEvent.hover(trigger());
  await expect.element(details()).toBeVisible();
  await expect.element(composer).toHaveFocus();
  await userEvent.click(trigger());
  expect(openFull).toHaveBeenCalledOnce();
});

it("keeps details open when focus enters the popup and dismisses on outside focus", async () => {
  const openFull = vi.fn();
  await page.viewport(1280, 800);
  await using screen = await render(
    <>
      <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
      <input aria-label="Composer" style={{ position: "fixed", bottom: 0, right: 0 }} />
    </>,
  );
  await userEvent.tab();
  await expect.element(details()).toBeVisible();
  const popup = page.getByRole("dialog");
  await act(async () => (popup.element() as HTMLElement).focus());
  await expect.element(popup).toHaveFocus();
  await expect.element(details()).toBeVisible();
  await userEvent.click(screen.getByRole("textbox", { name: "Composer" }));
  await expect.element(details()).not.toBeInTheDocument();
  expect(openFull).not.toHaveBeenCalled();
});

it("shows details on keyboard focus and opens the full page with Enter", async () => {
  const openFull = vi.fn();
  await using _screen = await renderControl(openFull);
  await userEvent.tab();
  await expect.element(details()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(details()).not.toBeInTheDocument();
  expect(openFull).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  expect(openFull).toHaveBeenCalledOnce();
});

it("opens the full usage page with Space", async () => {
  const openFull = vi.fn();
  await using _screen = await renderControl(openFull);
  await userEvent.tab();
  await expect.element(details()).toBeVisible();
  await userEvent.keyboard(" ");
  expect(openFull).toHaveBeenCalledOnce();
});

it("explains verified quota access when session sign-in is unconfirmed", async () => {
  const notice = "Antigravity quota access verified; session sign-in is not yet confirmed.";
  await using _screen = await render(
    <CompactUsageControl
      accounts={[
        account("antigravity", [
          { id: "gemini-pro", kind: "weekly", label: "Gemini Pro · Weekly", usedPercent: 25 },
        ]),
      ]}
      drivers={new Set(["antigravity"])}
      authNotices={[notice]}
      onOpenFullView={() => {}}
    />,
  );
  await userEvent.hover(trigger());
  await expect.element(page.getByText(notice, { exact: true })).toBeVisible();
  await expect.element(page.getByText("75%", { exact: true }).first()).toBeVisible();
});

it("shows every reported window of all harnesses in one shared popup", async () => {
  const accounts = [
    account("codex", [
      { id: "primary", kind: "session", label: "5h", usedPercent: 65 },
      { id: "secondary", kind: "weekly", label: "Week", usedPercent: 32 },
    ]),
    account("claudeAgent", [
      { id: "five_hour", kind: "session", label: "Session", usedPercent: 67 },
      { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 39 },
      { id: "seven_day_opus", kind: "weekly", label: "Weekly Opus", usedPercent: 52 },
      { id: "monthly_spend", kind: "monthly", label: "Monthly spend", usedPercent: 17 },
    ]),
    account("antigravity", [
      { id: "gemini-5h", kind: "session", label: "Gemini · 5-hour", usedPercent: 0 },
      { id: "gemini-weekly", kind: "weekly", label: "Gemini · Weekly", usedPercent: 12 },
      {
        id: "3p-weekly",
        kind: "weekly",
        label: "Claude & GPT (shared) · Weekly",
        usedPercent: 26,
      },
    ]),
  ];
  await using _screen = await render(
    <CompactUsageControl
      accounts={accounts}
      drivers={new Set(["codex", "claudeAgent", "antigravity"])}
      onOpenFullView={() => {}}
    />,
  );
  await expect
    .element(
      page.getByRole("button", {
        name: "Usage remaining: Codex 35%, Claude 33%, Antigravity 74%. Open full usage",
      }),
    )
    .toBeVisible();
  await userEvent.hover(trigger());
  const popup = page.getByRole("dialog");
  await expect.element(popup).toBeVisible();
  const codex = popup.getByRole("region", { name: "Codex" });
  await expect.element(codex.getByText("5h", { exact: true })).toBeVisible();
  await expect.element(codex.getByText("Week", { exact: true })).toBeVisible();
  const claude = popup.getByRole("region", { name: "Claude" });
  for (const label of ["Session", "Weekly", "Weekly Opus", "Monthly spend"]) {
    await expect.element(claude.getByText(label, { exact: true })).toBeVisible();
  }
  await expect.element(claude.getByText("83%", { exact: true })).toBeVisible();
  const agy = popup.getByRole("region", { name: "Antigravity" });
  await expect.element(agy.getByText("Gemini", { exact: true })).toBeVisible();
  await expect.element(agy.getByText("Claude & GPT (shared)", { exact: true })).toBeVisible();
  await expect.element(agy.getByText("5-hour", { exact: true })).toBeVisible();
});

it("keeps an authenticated harness without readable limits as unknown", async () => {
  await using _screen = await render(
    <CompactUsageControl
      accounts={[account("codex", [{ id: "s", kind: "session", label: "5h", usedPercent: 20 }])]}
      drivers={new Set(["codex", "claudeAgent"])}
      onOpenFullView={() => {}}
    />,
  );
  await expect
    .element(
      page.getByRole("button", {
        name: "Usage remaining: Codex 80%, Claude ?. Open full usage",
      }),
    )
    .toBeVisible();
  await userEvent.hover(trigger());
  await expect
    .element(
      page.getByRole("region", { name: "Claude" }).getByText("Limits unavailable", { exact: true }),
    )
    .toBeVisible();
  await expect.element(page.getByRole("region", { name: "Antigravity" })).not.toBeInTheDocument();
});

it("marks readable quotas partial when a connected source fails", async () => {
  const report = compactUsageReport(
    new Map([
      [
        EnvironmentId.make("test"),
        {
          entry: { target: { label: "Test" } },
          serverConfig: {
            providers: [],
            usageLimitSources: [
              {
                id: UsageLimitSourceId.make("proxy"),
                kind: "cliproxy",
                label: "CLI Proxy",
                checkedAt: "2026-10-26T12:00:00Z",
                error: "Source probe failed",
                accounts: [
                  {
                    id: "good",
                    driver: ProviderDriverKind.make("codex"),
                    usageLimits: {
                      checkedAt: "2026-10-26T12:00:00Z",
                      windows: [{ id: "session", kind: "session", label: "5h", usedPercent: 0 }],
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    ]),
  );
  await using _screen = await render(<CompactUsageControl {...report} onOpenFullView={() => {}} />);
  await userEvent.hover(
    page.getByRole("button", {
      name: "Usage remaining: Codex 100%. Partial report. Open full usage",
    }),
  );
  await expect
    .element(page.getByRole("region", { name: "Codex" }).getByText("5h", { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("Partial report. Some account limits are unavailable.", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("CLI Proxy: Source probe failed", { exact: true }))
    .toBeVisible();
});
