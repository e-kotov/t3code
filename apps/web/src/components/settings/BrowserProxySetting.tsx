import { normalizeBrowserProxyUrl } from "@t3tools/contracts";
import { useState } from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdatePrimarySettings,
} from "~/hooks/useSettings";
import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function BrowserProxySetting() {
  const settings = useClientSettings((value) => value.browserProxy);
  const hydrated = useClientSettingsHydrated();
  const update = useUpdatePrimarySettings();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsRow
      {...searchableSetting("browser-proxy")}
      description="Use a proxy for new tabs. Proxy tabs run on the environment host with separate logins. Local development sites stay direct. Existing tabs keep their route."
      control={
        <Switch
          aria-label="Use browser proxy"
          checked={settings.enabled}
          disabled={!hydrated || (!settings.enabled && (!settings.url || error !== null))}
          onCheckedChange={(enabled) => update({ browserProxy: { ...settings, enabled } })}
        />
      }
    >
      <div className="mt-2 max-w-lg">
        <DraftInput
          aria-label="Browser proxy URL"
          aria-invalid={error !== null}
          disabled={!hydrated}
          placeholder="socks5://127.0.0.1:1080"
          value={settings.url}
          onCommit={(value) => {
            try {
              const url = normalizeBrowserProxyUrl(value.trim());
              setError(null);
              update({ browserProxy: { enabled: settings.enabled && url !== "", url } });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Invalid proxy URL.");
            }
          }}
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  );
}
