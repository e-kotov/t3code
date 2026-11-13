import { msg } from "gt-react";
import type { SettingsSearchItem } from "./settingsSearch";

export const SETTLE_NAVIGATION_SEARCH_ITEMS = [
  {
    id: "settle-navigation",
    title: msg("After settling the open thread"),
    to: "/settings/general",
    searchTerms: ["settle stay next thread new chat unread automatic advance navigation"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
