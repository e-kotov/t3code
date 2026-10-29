import { ProviderDriverKind } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import "../index.css";
import { CompactUsageControl } from "./CompactUsageControl";

it("names disconnected machines while keeping Gemini and Argon quotas distinct", async () => {
  await page.viewport(1000, 520);
  await using screen = await render(
    <div className="p-8">
      <CompactUsageControl
        accounts={[
          {
            key: "antigravity",
            driver: ProviderDriverKind.make("antigravity"),
            displayName: null,
            email: undefined,
            plan: undefined,
            accentColor: undefined,
            environments: [],
            sourceLabel: null,
            redeem: null,
            limits: {
              checkedAt: "2026-10-29T18:00:00Z",
              windows: [
                { id: "gemini-weekly", kind: "weekly", label: "Gemini · Weekly", usedPercent: 41 },
                { id: "gemini-5h", kind: "session", label: "Gemini · 5-hour", usedPercent: 0 },
                {
                  id: "gemini-argon-wtu-weekly",
                  kind: "weekly",
                  label: "Gemini 4 Argon · Weekly",
                  usedPercent: 99,
                },
              ],
            },
          },
        ]}
        drivers={new Set(["antigravity"])}
        disconnected={["Phone", "GWDG"]}
        onOpenFullView={() => {}}
      />
    </div>,
  );
  await userEvent.hover(screen.getByRole("button", { name: /^Usage remaining/ }));
  const popup = page.getByRole("dialog");
  await expect.element(popup).toBeVisible();
  await page.screenshot({ path: "./__screenshots__/quota-warning.png" });
  await expect
    .element(
      page.getByText("Phone and GWDG are disconnected; their values may be out of date.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(popup.getByText("Gemini 4 Argon", { exact: true })).toBeVisible();
  await expect.element(popup.getByText("Gemini", { exact: true })).toBeVisible();
  await expect.element(popup.getByText("1%", { exact: true }).last()).toBeVisible();
});
