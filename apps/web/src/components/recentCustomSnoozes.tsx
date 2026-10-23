import { MenuItem, MenuSeparator, MenuShortcut } from "./ui/menu";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { recentSnoozePresets, selectSnoozePreset } from "./recentCustomSnoozeHistory";

export function RecentCustomSnoozeMenuItems(props: {
  readonly onSnooze: (choice: { readonly snoozedUntil: string }) => void;
  readonly timestampFormat: TimestampFormat;
}) {
  const choices = recentSnoozePresets(new Date(), props.timestampFormat);
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
