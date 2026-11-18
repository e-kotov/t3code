import { useMessages } from "gt-react";
import { useNowSecond } from "../hooks/useNowSecond";
import { useNowAfter } from "../hooks/useDeadline";
import { MenuItem, MenuSeparator, MenuShortcut } from "./ui/menu";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { recentSnoozePresets, selectSnoozePreset } from "./recentCustomSnoozeHistory";

export function RecentCustomSnoozeMenuItems(props: {
  readonly onSnooze: (choice: { readonly snoozedUntil: string }) => void;
  readonly timestampFormat: TimestampFormat;
}) {
  const messages = useMessages();
  const now = useNowAfter(useNowSecond());
  const choices = recentSnoozePresets(new Date(now), props.timestampFormat, messages);
  if (choices.length === 0) return null;
  return (
    <>
      <MenuSeparator />
      {choices.map((choice) => (
        <MenuItem
          key={choice.id}
          onClick={(event) => {
            event.stopPropagation();
            const selected = selectSnoozePreset(choices, `snooze:${choice.id}`);
            if (selected) props.onSnooze({ snoozedUntil: selected.snoozedUntil });
          }}
        >
          {choice.label}
          <MenuShortcut>{choice.whenLabel}</MenuShortcut>
        </MenuItem>
      ))}
    </>
  );
}
