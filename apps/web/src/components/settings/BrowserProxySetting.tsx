import { normalizeBrowserProxyUrl } from "@t3tools/contracts";
import { useState } from "react";

import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings, useScopedSettingsWriteAllowed } from "./useScopedSettings";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export function BrowserProxySetting() {
  const settings = useScopedSettings((value) => value.browserProxy);
  const context = useSettingsScope();
  const update = useUpdateScopedSettings();
  const writable = useScopedSettingsWriteAllowed();
  const [error, setError] = useState<string | null>(null);
  const supported = context.connectedEnvironments.length > 0 && context.connectedEnvironments.every((target) => target.serverConfig?.environment.capabilities.browserProxy === true);
  const disabled = !writable || !supported || context.scope.kind === "project" || context.scope.kind === "checkout";
  return (
    <SettingsRow
      {...searchableSetting("browser-proxy")}
      serverScoped
      settingKeys={["browserProxy"]}
      description={supported ? "Default route for this environment's agents and new external tabs. Existing tabs keep their route. Local and app resources stay direct." : "Update the selected environment's T3 Code server to configure its browser proxy."}
      control={
        <Switch
          aria-label="Use browser proxy"
          checked={settings.enabled}
          disabled={disabled || (!settings.enabled && (!settings.url || error !== null))}
          onCheckedChange={(enabled) => update({ browserProxy: { ...settings, enabled } })}
        />
      }
    >
      <div className="mt-2 max-w-lg">
        <DraftInput
          aria-label="Browser proxy URL"
          aria-invalid={error !== null}
          disabled={disabled}
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
        {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      </div>
    </SettingsRow>
  );
}
