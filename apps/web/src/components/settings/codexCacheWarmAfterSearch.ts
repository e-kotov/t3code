import { msg } from "gt-react";
import type { SettingsSearchItem } from "./settingsSearch";

export const CODEX_CACHE_WARM_AFTER_SEARCH_ITEMS = [
  {
    id: "codex-cache-warm-after",
    title: msg("Warm Codex after"),
    to: "/settings/providers",
    scope: "environment-defaults",
    searchTerms: [msg("keep warm prompt cache codex idle interval minutes hours expiry billable")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
