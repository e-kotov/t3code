import {
  resolveCustomSnooze as resolveUpstreamCustomSnooze,
  type CustomSnoozeInput,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  RECENT_CUSTOM_SNOOZES_KEY,
  recentCustomSnoozes,
} from "@t3tools/shared/recentCustomSnoozes";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { resolveSnoozePresets as resolveUpstreamPresets } from "./Sidebar.snooze";
import { formatShortTimestamp } from "../timestampFormat";

export type ForkSnoozePreset = Omit<SnoozePreset, "id"> & { readonly id: string };

function readHistory(now: Date) {
  try {
    return recentCustomSnoozes(
      JSON.parse(window.localStorage.getItem(RECENT_CUSTOM_SNOOZES_KEY) ?? "[]"),
      now,
    );
  } catch {
    return [];
  }
}

function remember(snoozedUntil: string, now: Date) {
  try {
    window.localStorage.setItem(
      RECENT_CUSTOM_SNOOZES_KEY,
      JSON.stringify(recentCustomSnoozes([snoozedUntil, ...readHistory(now)], now)),
    );
  } catch {
    /* An unavailable history must not prevent snoozing. */
  }
}

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date) {
  const result = resolveUpstreamCustomSnooze(input, now);
  if (result && input.mode === "date") remember(result, now);
  return result;
}

export function recentSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
): ReadonlyArray<ForkSnoozePreset> {
  return readHistory(now).map((snoozedUntil) => ({
    id: `recent:${snoozedUntil}`,
    label: `Recent: ${new Date(snoozedUntil).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
    whenLabel: formatShortTimestamp(snoozedUntil, timestampFormat),
    snoozedUntil,
  }));
}

export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
): ReadonlyArray<ForkSnoozePreset> {
  return [
    ...resolveUpstreamPresets(now, timestampFormat),
    ...recentSnoozePresets(now, timestampFormat),
  ];
}

export function selectSnoozePreset(
  presets: ReadonlyArray<ForkSnoozePreset>,
  action: string,
  now = new Date(),
) {
  const choice = presets.find((candidate) => `snooze:${candidate.id}` === action);
  if (!choice || Date.parse(choice.snoozedUntil) <= now.getTime()) return undefined;
  if (choice.id.startsWith("recent:")) remember(choice.snoozedUntil, now);
  return choice;
}
