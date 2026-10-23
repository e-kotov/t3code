import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { RECENT_CUSTOM_SNOOZES_KEY } from "@t3tools/shared/recentCustomSnoozes";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { RecentCustomSnoozeMenuItems } from "./recentCustomSnoozes";

it("offers persisted custom dates and snoozes another thread to the selected exact instant", async () => {
  const dates = ["2099-10-24T12:45:00.000Z", "2099-10-25T13:15:00.000Z", "2099-10-26T14:30:00.000Z"];
  using _read = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => key === RECENT_CUSTOM_SNOOZES_KEY ? JSON.stringify(["2020-01-01", ...dates]) : null);
  const onSnooze = vi.fn();
  await using screen = await render(
    <Menu>
      <MenuTrigger>Choose snooze</MenuTrigger>
      <MenuPopup>
        <RecentCustomSnoozeMenuItems onSnooze={onSnooze} timestampFormat="24-hour" />
      </MenuPopup>
    </Menu>,
  );
  await screen.getByRole("button", { name: "Choose snooze" }).click();
  await expect.element(screen.getByRole("menuitem").nth(2)).toBeVisible();
  await expect.element(screen.getByRole("menuitem").nth(3)).not.toBeInTheDocument();
  await screen.getByRole("menuitem").nth(1).click();
  expect(onSnooze).toHaveBeenCalledExactlyOnceWith({ snoozedUntil: dates[1] });
});
