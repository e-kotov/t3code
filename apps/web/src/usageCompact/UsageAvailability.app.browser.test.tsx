import { createMemoryHistory } from "@tanstack/react-router";
import { UsageLimitSourceId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import "../index.css";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});
vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));
vi.mock(import("../hooks/useNowMinute"), () => ({
  useNowMinute: () => "2026-11-13T16:00",
}));

/** A user-hosted quota source with two pools, in the shape of a request-counting gateway. */
function quotaSources(now: number) {
  const quotaWindow = (id: string, label: string, usedPercent: number, hours: number) => ({
    id,
    kind: id.endsWith("month") ? ("monthly" as const) : ("other" as const),
    label,
    usedPercent,
    resetsAt: new Date(now + hours * 60 * 60_000).toISOString(),
  });
  return [
    {
      id: UsageLimitSourceId.make("lab-quota"),
      kind: "http" as const,
      label: "Lab quota",
      checkedAt: new Date(now).toISOString(),
      accounts: [],
      quotaAccounts: [
        {
          id: "pool-a",
          label: "Pool A",
          windows: [
            quotaWindow("day", "Day (1517/1600)", 5, 10),
            quotaWindow("month", "Month (5057/6000)", 16, 24 * 27),
          ],
        },
        {
          id: "pool-b",
          label: "Pool B",
          windows: [
            quotaWindow("day", "Day (758/800)", 5, 10),
            quotaWindow("hour", "Hour (366/400)", 9, 0.5),
            quotaWindow("month", "Month (2528/3000)", 16, 24 * 27),
          ],
        },
      ],
    },
  ];
}

it("shows read-only resets in the popup and all pace states after opening Usage", async () => {
  const now = Date.parse("2026-11-13T16:00:00Z");
  using _now = vi.spyOn(Date, "now").mockReturnValue(now);
  const checkedAt = new Date(now).toISOString();
  const thread = threadWithHistory("usage-availability", 1);
  const weekly = {
    id: "weekly",
    kind: "weekly",
    label: "Weekly",
    resetsAt: new Date(now + 3.5 * 24 * 60 * 60_000).toISOString(),
    windowDurationMins: 7 * 24 * 60,
  };
  using _environment = installFakeEnvironment([thread], {
    providers: [
      {
        ...CODEX_PROVIDER,
        usageLimits: {
          checkedAt,
          resetCredits: { availableCount: 1 },
          windows: [{ ...weekly, usedPercent: 50 }],
        },
      },
      {
        ...CLAUDE_PROVIDER,
        usageLimits: {
          checkedAt,
          resetCredits: { availableCount: 3 },
          windows: [
            {
              id: "session",
              kind: "session",
              label: "Session",
              usedPercent: 25,
              resetsAt: new Date(now + 2.5 * 60 * 60_000).toISOString(),
              windowDurationMins: 300,
            },
            { ...weekly, usedPercent: 75 },
            { id: "fable", kind: "weekly", label: "Weekly · Fable", usedPercent: 10 },
          ],
        },
      },
    ],
    usageLimitSources: quotaSources(now),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    usagePopupEnabled: true,
    usagePopupHoverDelayMs: 0,
  });
  await page.viewport(1440, 1000);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  const trigger = page.getByRole("button", { name: /^Usage remaining/ });
  await userEvent.hover(trigger);
  const popup = page.getByRole("dialog");
  await expect.element(popup.getByText("Quota remaining", { exact: true })).toBeVisible();
  const capture = import.meta.env.VITE_USAGE_AVAILABILITY_CAPTURE;
  if (capture) {
    await document.fonts.ready;
    await popup.screenshot({
      path: `../../../../.t3/usage-availability-evidence/${capture}-popup.png`,
    });
  }
  if (capture !== "before") {
    const resets = popup.getByText("3 resets available", { exact: true });
    await expect.element(resets).toBeVisible();
    await expect.element(popup.getByText("1 reset available", { exact: true })).toBeVisible();
    expect(resets.element().closest("button, a, [role=button]")).toBeNull();
    expect((resets.element() as HTMLElement).tabIndex).toBe(-1);
    await userEvent.click(resets);
    await expect.element(popup.getByText("Quota remaining", { exact: true })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${thread.id}`);
  }
  await userEvent.click(trigger);
  await expect.element(page.getByText("Weekly · Fable", { exact: true })).toBeVisible();
  if (capture !== "before") {
    for (const label of ["Ahead of pace", "On pace", "Under pace"]) {
      await expect.element(page.getByText(label, { exact: true })).toBeVisible();
    }
  }
  await expect.element(page.getByRole("button", { name: "Limits", exact: true })).toBeVisible();
  if (capture !== "before") {
    // Exact counts stay on Usage, drawn once as bars rather than also as upstream's text rows.
    const source = page.getByRole("region", { name: "Lab quota" });
    await expect.element(source.getByText("Pool B", { exact: true })).toBeVisible();
    await expect.element(source.getByText("Hour (366/400)", { exact: true })).toBeVisible();
    expect(page.getByText("Day (1517/1600)", { exact: true }).elements()).toHaveLength(1);
  }
  if (capture) {
    await app.locator.screenshot({
      path: `../../../../.t3/usage-availability-evidence/${capture}-usage.png`,
    });
  }
});

it("keeps the thread header clear of a usage control that grows with quota sources", async () => {
  const now = Date.parse("2026-11-13T16:00:00Z");
  using _now = vi.spyOn(Date, "now").mockReturnValue(now);
  const thread = threadWithHistory("usage-header-fit", 1);
  const limits = {
    checkedAt: new Date(now).toISOString(),
    windows: [
      { id: "session", kind: "session", label: "Session", usedPercent: 10 },
      { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 40 },
    ],
  };
  using _environment = installFakeEnvironment([thread], {
    providers: [
      { ...CODEX_PROVIDER, usageLimits: limits },
      { ...CLAUDE_PROVIDER, usageLimits: limits },
    ],
    usageLimitSources: quotaSources(now),
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1440, 1000);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using app = await render(<AppRoot router={router} />, {
    // AppRoot owns the router, as it does in main.tsx.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /^Usage remaining: .*Pool B/ }))
    .toBeVisible();
  const capture = import.meta.env.VITE_USAGE_AVAILABILITY_CAPTURE;
  if (capture) {
    await document.fonts.ready;
    const header = app.container.querySelector<HTMLElement>("[data-chat-header]")!;
    await page.elementLocator(header).screenshot({
      path: `../../../../.t3/usage-availability-evidence/${capture}-header.png`,
    });
  }
  const breadcrumb = app.container.querySelector('[aria-label="Thread breadcrumb"]')!;
  const usage = app.container.querySelector("[data-header-usage]")!;
  await vi.waitFor(() => {
    expect(
      breadcrumb.getBoundingClientRect().right,
      "HEADER_USAGE_OVERLAP: the thread header must end before the usage control starts",
    ).toBeLessThanOrEqual(usage.getBoundingClientRect().left);
  });
});
