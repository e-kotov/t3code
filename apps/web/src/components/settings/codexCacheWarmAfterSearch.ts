import { msg } from "gt-react";
import type { SettingsSearchItem } from "./settingsSearch";

export const CODEX_CACHE_WARM_AFTER_SEARCH_ITEMS = [
  {
    id: "machine-idle-policy",
    title: msg("While idle"),
    to: "/settings/providers",
    scope: "environment-defaults",
    searchTerms: [msg("Minimum context (k tokens)"), msg("Idle time (min)")],
  },
  {
    id: "codex-cache-warm-after",
    title: msg("Warm Codex after"),
    to: "/settings/providers",
    scope: "environment-defaults",
    searchTerms: [msg("keep warm prompt cache codex idle interval minutes hours expiry billable")],
  },
  {
    id: "neon-cache-warm-after",
    title: msg("Warm Neon after"),
    to: "/settings/providers",
    scope: "environment-defaults",
    searchTerms: [msg("Idle cache policy")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
