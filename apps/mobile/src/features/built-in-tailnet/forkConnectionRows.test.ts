import { expect, it } from "vite-plus/test";
import { filterSettingsSections } from "../settings/settings-search";
import { forkConnectionRows } from "./forkConnectionRows";
import {
  rememberedSettingsPage,
  workspaceSelectionsIn,
} from "../workspace/workspace-tab-navigation";

const enabled = {
  android: true,
  available: true,
  enabled: true,
  signedIn: true,
  position: "last" as const,
};

it("keeps local Android notifications reachable and makes tailnet searchable", () => {
  const rows = forkConnectionRows([], enabled);
  expect(rows.map((row) => row.target)).toEqual([
    "SettingsNotifications",
    "SettingsBuiltInTailscale",
  ]);
  expect(filterSettingsSections([{ title: "Connections", rows }], "tailscale")[0]?.rows).toEqual([
    expect.objectContaining({ target: "SettingsBuiltInTailscale", value: "Last" }),
  ]);
});

it("keeps configured account rows and avoids duplicate notifications", () => {
  const rows = [
    { id: "account", icon: "person.crop.circle" as const, label: "Account" },
    {
      id: "SettingsNotifications",
      icon: "bell.badge" as const,
      label: "Notifications",
      target: "SettingsNotifications" as const,
    },
  ];
  expect(forkConnectionRows(rows, enabled).map((row) => row.id)).toEqual([
    "account",
    "SettingsNotifications",
    "SettingsBuiltInTailscale",
  ]);
  expect(forkConnectionRows(rows, { ...enabled, android: false })).toBe(rows);
});

it("hides an unavailable engine and distinguishes disabled and unsigned-in states", () => {
  expect(forkConnectionRows([], { ...enabled, available: false }).map((row) => row.id)).toEqual([
    "SettingsNotifications",
  ]);
  expect(forkConnectionRows([], { ...enabled, enabled: false }).at(-1)?.value).toBe("Off");
  expect(forkConnectionRows([], { ...enabled, signedIn: false }).at(-1)?.value).toBe(
    "Not signed in",
  );
});

it("reopens the tailnet page when returning to Settings", () => {
  const selections = workspaceSelectionsIn(
    [{ name: "Home" }, { name: "Settings" }, { name: "SettingsBuiltInTailscale", key: "tailnet" }],
    {},
  );
  expect(selections.settings).toBe("SettingsBuiltInTailscale");
  expect(rememberedSettingsPage(selections)).toBe("SettingsBuiltInTailscale");
});
