import { msg } from "gt-react-native";
import { m, type MessageResolver } from "../../i18n/messages";
import type { ComponentProps } from "react";
import type { SettingsRow } from "../settings/components/SettingsRow";
import type { BuiltInTailnetPosition } from "./builtInTailnet";

type Row = ComponentProps<typeof SettingsRow> & { readonly id: string };
const POSITION_LABELS = {
  first: msg("First"),
  "before-tailscale": msg("Before Tailscale app"),
  "after-tailscale": msg("After Tailscale app"),
  last: msg("Last"),
} as const;

export function forkConnectionRows(
  rows: readonly Row[],
  input: {
    readonly android: boolean;
    readonly available: boolean;
    readonly enabled: boolean;
    readonly signedIn: boolean;
    readonly position: BuiltInTailnetPosition;
  },
  resolve: MessageResolver = m,
): readonly Row[] {
  if (!input.android) return rows;
  return [
    ...rows,
    ...(rows.some((row) => row.id === "SettingsNotifications")
      ? []
      : [
          {
            id: "SettingsNotifications",
            icon: "bell.badge",
            label: resolve(msg("Notifications")),
            target: "SettingsNotifications",
          } satisfies Row,
        ]),
    ...(input.available
      ? [
          {
            id: "SettingsBuiltInTailscale",
            icon: "point.3.connected.trianglepath.dotted",
            label: resolve(msg("Built-in Tailscale")),
            value: !input.enabled
              ? resolve(msg("Off"))
              : !input.signedIn
                ? resolve(msg("Not signed in"))
                : resolve(POSITION_LABELS[input.position]),
            valuePosition: "trailing",
            target: "SettingsBuiltInTailscale",
          } satisfies Row,
        ]
      : []),
  ];
}
