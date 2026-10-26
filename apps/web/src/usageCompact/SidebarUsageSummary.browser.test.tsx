import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { CompactUsageControl } from "./CompactUsageControl";
import { EnvironmentId, ProviderDriverKind, UsageLimitSourceId } from "@t3tools/contracts";
import { compactUsageReport } from "./usageCompactReport";

it("opens a compact summary before opening the full usage page", async () => {
  const openFull = vi.fn();
  await using screen = await render(
    <ul>
      <CompactUsageControl accounts={[]} onOpenFullView={openFull} />
    </ul>,
  );
  await userEvent.click(screen.getByRole("button", { name: /Usage remaining/ }));
  await expect.element(page.getByText("Quota remaining", { exact: true })).toBeVisible();
  expect(openFull).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByText("Quota remaining", { exact: true })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Usage remaining/ }));
  await userEvent.click(page.getByRole("button", { name: "Open full usage" }));
  expect(openFull).toHaveBeenCalledOnce();
  await expect.element(page.getByText("Quota remaining", { exact: true })).not.toBeInTheDocument();
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
  const trigger = screen.getByRole("button", { name: /Usage remaining.*Partial report/ });
  await expect.element(screen.getByText("100%*", { exact: true })).toBeVisible();
  await userEvent.click(trigger);
  await expect
    .element(
      page.getByText("* Partial report. Some account limits are unavailable.", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("CLI Proxy: Source probe failed", { exact: true }))
    .toBeVisible();
});
