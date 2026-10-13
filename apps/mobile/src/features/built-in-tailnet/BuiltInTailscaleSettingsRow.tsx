import { SettingsRow } from "../settings/components/SettingsRow";
import { builtInTailnetAvailable, useBuiltInTailnet } from "./builtInTailnet";

const POSITION_LABELS = {
  first: "First",
  "before-tailscale": "Before Tailscale app",
  "after-tailscale": "After Tailscale app",
  last: "Last",
} as const;

/** Settings index row; only Android builds that include the engine show it. */
export function BuiltInTailscaleSettingsRow() {
  const { enabled, position, signedIn } = useBuiltInTailnet();
  if (!builtInTailnetAvailable()) return null;
  return (
    <SettingsRow
      icon="point.3.connected.trianglepath.dotted"
      label="Built-in Tailscale"
      value={!enabled ? "Off" : !signedIn ? "Not signed in" : POSITION_LABELS[position]}
      valuePosition="trailing"
      target="SettingsBuiltInTailscale"
    />
  );
}
