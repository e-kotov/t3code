import { m } from "../../i18n/messages";
import { expect, it } from "vite-plus/test";
import { SETTINGS_SEARCH_ITEMS, searchSettings } from "./settingsSearch";

it("finds the settle destination by its behavior and links to the row", () => {
  for (const query of ["settle", "stay", "next thread", "new chat", "unread", "advance"]) {
    expect(searchSettings(query)).toContainEqual(
      expect.objectContaining({ id: "settle-navigation", to: "/settings/general" }),
    );
  }
  const setting = SETTINGS_SEARCH_ITEMS.find((item) => item.id === "settle-navigation")!;
  expect({ id: setting.id, title: m(setting.title) }).toEqual({
    id: "settle-navigation",
    title: "After settling the open thread",
  });
  expect(
    searchSettings("nach abschluss", undefined, (title) =>
      m(title) === "After settling the open thread" ? "Nach Abschluss des Threads" : m(title),
    ),
  ).toContainEqual(expect.objectContaining({ id: "settle-navigation" }));
});
