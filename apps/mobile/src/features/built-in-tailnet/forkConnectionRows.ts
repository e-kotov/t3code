import type { ComponentProps } from "react";
import type { SettingsRow } from "../settings/components/SettingsRow";
import type { BuiltInTailnetPosition } from "./builtInTailnet";

type Row = ComponentProps<typeof SettingsRow> & { readonly id: string };
const POSITION_LABELS = {
  first: "First",
  "before-tailscale": "Before Tailscale app",
  "after-tailscale": "After Tailscale app",
  last: "Last",
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
            label: "Notifications",
            target: "SettingsNotifications",
          } satisfies Row,
        ]),
    ...(input.available
      ? [
          {
            id: "SettingsBuiltInTailscale",
            icon: "point.3.connected.trianglepath.dotted",
            label: "Built-in Tailscale",
            value: !input.enabled
              ? "Off"
              : !input.signedIn
                ? "Not signed in"
                : POSITION_LABELS[input.position],
            valuePosition: "trailing",
            target: "SettingsBuiltInTailscale",
          } satisfies Row,
        ]
      : []),
  ];
}
