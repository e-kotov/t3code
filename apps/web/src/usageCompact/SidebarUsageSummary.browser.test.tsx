import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { CompactUsageControl } from "./CompactUsageControl";
import { EnvironmentId, ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import { compactUsageReport } from "./usageCompactReport";

function renderControl(openFull: () => void) {
  return render(
    <ul>
      <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
    </ul>,
  );
}

const details = () => page.getByText("Quota remaining", { exact: true });

it("shows quota details on hover without opening the full usage page", async () => {
  const openFull = vi.fn();
  await using screen = await renderControl(openFull);
  await userEvent.hover(screen.getByRole("button", { name: /Usage remaining/ }));
  await expect.element(details()).toBeVisible();
  await userEvent.hover(details());
  await expect.element(details()).toBeVisible();
  await userEvent.unhover(details());
  await expect.element(details()).not.toBeInTheDocument();
  expect(openFull).not.toHaveBeenCalled();
});

it("opens the full usage page on the first click", async () => {
  const openFull = vi.fn();
  await using screen = await renderControl(openFull);
  await userEvent.click(screen.getByRole("button", { name: /Usage remaining/ }));
  expect(openFull).toHaveBeenCalledOnce();
});

it("keeps composer focus on hover and opens the full page after reading details", async () => {
  const openFull = vi.fn();
  await using screen = await render(
    <>
      <ul>
        <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
      </ul>
      <input aria-label="Composer" />
    </>,
  );
  const composer = screen.getByRole("textbox", { name: "Composer" });
  const trigger = screen.getByRole("button", { name: /Usage remaining/ });
  await userEvent.click(composer);
  await userEvent.hover(trigger);
  await expect.element(details()).toBeVisible();
  await expect.element(composer).toHaveFocus();
  await userEvent.click(trigger);
  expect(openFull).toHaveBeenCalledOnce();
});

it("keeps details open when focus enters the popup and dismisses on outside focus", async () => {
  const openFull = vi.fn();
  await using screen = await render(
    <>
      <ul>
        <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
      </ul>
      <input aria-label="Composer" />
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
  await using screen = await render(
    <ul>
      <CompactUsageControl {...report} onOpenFullView={() => {}} />
    </ul>,
  );
  await userEvent.hover(screen.getByRole("button", { name: /Usage remaining.*Partial report/ }));
  await expect.element(page.getByText("100%", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("Partial report. Some account limits are unavailable.", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("CLI Proxy: Source probe failed", { exact: true }))
    .toBeVisible();
});
