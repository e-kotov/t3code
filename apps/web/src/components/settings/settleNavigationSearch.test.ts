import { expect, it } from "vite-plus/test";
import { searchableSetting, searchSettings } from "./settingsSearch";

it("finds the settle destination by its behavior and links to the row", () => {
  for (const query of ["settle", "stay", "next thread", "new chat", "unread", "advance"]) {
    expect(searchSettings(query)).toContainEqual(
      expect.objectContaining({ id: "settle-navigation", to: "/settings/general" }),
    );
  }
  expect(searchableSetting("settle-navigation")).toEqual({
    id: "settle-navigation",
    title: "After settling the open thread",
  });
  expect(
    searchSettings("nach abschluss", undefined, (title) =>
      title === "After settling the open thread" ? "Nach Abschluss des Threads" : title,
    ),
  ).toContainEqual(expect.objectContaining({ id: "settle-navigation" }));
});
