import { useSyncExternalStore } from "react";
import {
  resolveCustomSnooze as resolveUpstreamCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  createRecentCustomSnoozeStore,
  recentCustomSnoozes,
} from "@t3tools/shared/recentCustomSnoozes";
import { MenuItem, MenuSeparator, MenuShortcut } from "./ui/menu";
import { formatShortTimestamp } from "../timestampFormat";
import type { TimestampFormat } from "@t3tools/contracts/settings";

const history = createRecentCustomSnoozeStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date) {
  const result = resolveUpstreamCustomSnooze(input, now);
  if (result && input.mode === "date") void history.remember(result, now);
  return result;
}

export function RecentCustomSnoozeMenuItems(props: {
  readonly onSnooze: (choice: { readonly snoozedUntil: string }) => void;
  readonly timestampFormat: TimestampFormat;
}) {
  const stored = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const choices = recentCustomSnoozes(stored, new Date());
  if (choices.length === 0) return null;
  return (
    <>
      <MenuSeparator />
      {choices.map((snoozedUntil) => (
        <MenuItem
          key={snoozedUntil}
          onClick={(event) => {
            event.stopPropagation();
            const now = new Date();
            if (Date.parse(snoozedUntil) <= now.getTime()) return;
            void history.remember(snoozedUntil, now);
            props.onSnooze({ snoozedUntil });
          }}
        >
          Recent:{" "}
          {new Date(snoozedUntil).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          <MenuShortcut>{formatShortTimestamp(snoozedUntil, props.timestampFormat)}</MenuShortcut>
        </MenuItem>
      ))}
    </>
  );
}
