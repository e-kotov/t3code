import { SettingsRow } from "../settings/components/SettingsRow";
import { builtInTailnetAvailable, useBuiltInTailnet } from "./builtInTailnet";

/** Settings index row; only Android builds that include the engine show it. */
export function BuiltInTailscaleSettingsRow() {
  const { enabled, priority } = useBuiltInTailnet();
  if (!builtInTailnetAvailable()) return null;
  return (
    <SettingsRow
      icon="point.3.connected.trianglepath.dotted"
      label="Built-in Tailscale"
      value={enabled ? (priority === "preferred" ? "First" : "Fallback") : "Off"}
      valuePosition="trailing"
      target="SettingsBuiltInTailscale"
    />
  );
}
