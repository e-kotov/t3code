import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { CompactUsageControl } from "./CompactUsageControl";

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
