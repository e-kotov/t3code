import { UsageLimitSourceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { HttpQuotaCards } from "./HttpQuotaCards";
import type { CompactHttpQuotaSource } from "./usageCompact";

const NOW = Date.parse("2026-11-13T16:00:00Z");

type QuotaAccounts = NonNullable<CompactHttpQuotaSource["quotaAccounts"]>;

function source(quotaAccounts: QuotaAccounts): CompactHttpQuotaSource {
  return {
    id: UsageLimitSourceId.make("lab-quota"),
    key: "hub:lab-quota",
    kind: "http",
    label: "Lab quota",
    checkedAt: new Date(NOW).toISOString(),
    accounts: [],
    quotaAccounts,
  };
}

function inside(inner: Element, outer: Element) {
  const a = inner.getBoundingClientRect();
  const b = outer.getBoundingClientRect();
  return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
}

it("keeps account names beside pool titles and shows accounts without windows", async () => {
  const day = (usedPercent: number) => ({
    id: "api-day",
    kind: "other" as const,
    label: "API · Day (1517/1600)",
    usedPercent,
  });
  await using screen = await render(
    <HttpQuotaCards
      sources={[
        source([
          { id: "team-a", label: "Team A", windows: [day(5)] },
          { id: "team-b", label: "Team B", windows: [day(40)] },
          { id: "team-c", label: "Team C", windows: [] },
        ]),
      ]}
      now={NOW}
    />,
  );
  const region = screen.getByRole("region", { name: "Lab quota" });
  for (const name of ["Team A", "Team B", "Team C"]) {
    await expect.element(region.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  expect(region.getByText("API", { exact: true }).elements()).toHaveLength(2);
  await expect.element(region.getByText("No limits reported.", { exact: true })).toBeVisible();
});

it("shows full quota labels and reset text in a narrow window", async () => {
  await page.viewport(320, 800);
  const label = "Day (1517/1600) for the shared_department_inference_pool_with_a_long_name";
  await using screen = await render(
    <HttpQuotaCards
      sources={[
        source([
          {
            id: "team-a",
            label: "Team A",
            windows: [
              {
                id: "day",
                kind: "other",
                label,
                usedPercent: 5,
                resetsAt: new Date(NOW + 30_000).toISOString(),
              },
            ],
          },
        ]),
      ]}
      now={NOW}
    />,
  );
  const text = screen.getByText(label, { exact: true });
  await expect.element(text).toBeVisible();
  const labelElement = text.element() as HTMLElement;
  expect(labelElement.scrollWidth, "HTTP_QUOTA_CARD_LABEL_CLIPPED").toBeLessThanOrEqual(
    labelElement.clientWidth,
  );
  const reset = screen.getByText("Resets momentarily", { exact: true }).element() as HTMLElement;
  expect(reset.scrollWidth, "HTTP_QUOTA_CARD_RESET_CLIPPED").toBeLessThanOrEqual(reset.clientWidth);
  const bar = reset.closest(".overflow-hidden")!;
  expect(inside(reset, bar), "HTTP_QUOTA_CARD_RESET_OUTSIDE_BAR").toBe(true);
});
