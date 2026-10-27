import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { CommandPalette } from "./CommandPalette";

const optionLabels = async () =>
  (await page.getByRole("option").all()).map(
    (option) => option.element().textContent?.trim() ?? "",
  );

// The compiled device-command hook returns a cached array; the palette must copy it before
// appending its own actions, or every re-render appends them again.
it("keeps one copy of each action while the palette re-renders", async () => {
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

  openCommandPalette();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  const opened = await vi.waitFor(async () => {
    const labels = await optionLabels();
    expect(labels.length).toBeGreaterThan(0);
    return labels;
  });
  expect(new Set(opened).size).toBe(opened.length);

  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
  await userEvent.keyboard("se");
  await userEvent.keyboard("{Backspace}{Backspace}");

  // The virtualized list recycles option nodes, so their DOM order is not the visual order.
  await vi.waitFor(async () =>
    expect((await optionLabels()).toSorted()).toEqual(opened.toSorted()),
  );
});
