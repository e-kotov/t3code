import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { EnvironmentId } from "@t3tools/contracts";
import { RECENT_CUSTOM_SNOOZES_KEY } from "@t3tools/shared/recentCustomSnoozes";
import { Menu, MenuPopup, MenuTrigger } from "./ui/menu";
import { RecentCustomSnoozeMenuItems } from "./recentCustomSnoozes";
import {
  resolveCustomSnooze,
  resolveSnoozePresets,
  selectSnoozePreset,
} from "./recentCustomSnoozeHistory";

it("offers persisted custom dates and snoozes another thread to the selected exact instant", async () => {
  const dates = [
    "2099-10-24T12:45:00.000Z",
    "2099-10-25T13:15:00.000Z",
    "2099-10-26T14:30:00.000Z",
  ];
  using _read = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation((key) =>
      key === RECENT_CUSTOM_SNOOZES_KEY ? JSON.stringify(["2020-01-01", ...dates]) : null,
    );
  const onSnooze = vi.fn();
  using write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
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
  expect(write).toHaveBeenCalledWith(
    RECENT_CUSTOM_SNOOZES_KEY,
    JSON.stringify([dates[1], dates[0], dates[2]]),
  );
});

it("makes custom dates available to context and bulk menus while preserving presets and excluding durations", () => {
  let saved: string | null = null;
  using _read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => saved);
  using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementation((_key, value) => {
    saved = value;
  });
  const now = new Date(2026, 9, 23, 10);
  resolveCustomSnooze({ mode: "duration", amount: "2", unit: "hours" }, now);
  resolveCustomSnooze({ mode: "date", date: "invalid", time: "15:47" }, now);
  expect(saved).toBeNull();
  const selected = resolveCustomSnooze({ mode: "date", date: "2026-10-24", time: "15:47" }, now);
  const presets = resolveSnoozePresets(now, "24-hour", EnvironmentId.make("test-environment"));
  expect(presets[0]?.id).toBe("after:60");
  expect(presets.filter((preset) => preset.id.startsWith("recent:"))).toHaveLength(1);
  const action = `snooze:recent:${selected}`;
  expect(selectSnoozePreset(presets, action, now)?.snoozedUntil).toBe(selected);
  expect(selectSnoozePreset(presets, action, new Date(selected!))).toBeUndefined();
});
