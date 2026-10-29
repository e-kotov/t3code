import { useMemo, useSyncExternalStore } from "react";
import type { SnoozePresetSetting } from "@t3tools/contracts/settings";
import * as SecureStore from "expo-secure-store";
import {
  resolveCustomSnooze as resolveUpstreamCustomSnooze,
  resolveSnoozePresets,
  type CustomSnoozeInput,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  createRecentCustomSnoozeStore,
  recentCustomSnoozes,
} from "@t3tools/shared/recentCustomSnoozes";
import { resolveThreadListV2SnoozeMenuSelection as resolveUpstreamSelection } from "./threadListV2";

const history = createRecentCustomSnoozeStore({
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
});
type Choice = Omit<SnoozePreset, "id"> & { readonly id: string };

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date) {
  const result = resolveUpstreamCustomSnooze(input, now);
  if (result && input.mode === "date") void history.remember(result, now);
  return result;
}

export function useSnoozePresets(
  enabled: boolean,
  minute: string,
  presets?: ReadonlyArray<SnoozePresetSetting>,
): ReadonlyArray<Choice> {
  const stored = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  return useMemo(() => {
    if (!enabled) return [];
    const now = new Date(minute);
    return [
      ...resolveSnoozePresets(now, presets ? { presets } : {}),
      ...recentCustomSnoozes(stored, now).map((snoozedUntil) => ({
        id: `recent:${snoozedUntil}`,
        label: `Recent: ${new Date(snoozedUntil).toLocaleDateString()}`,
        whenLabel: new Date(snoozedUntil).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        snoozedUntil,
      })),
    ];
  }, [enabled, stored, minute, presets]);
}

export function resolveThreadListV2SnoozeMenuSelection(input: {
  readonly event: string;
  readonly displayedPresets: ReadonlyArray<Choice>;
  readonly now: Date;
  readonly presets?: ReadonlyArray<SnoozePresetSetting>;
}) {
  if (input.event.startsWith("snooze:recent:")) {
    const preset = input.displayedPresets.find((choice) => input.event === `snooze:${choice.id}`);
    if (!preset || Date.parse(preset.snoozedUntil) <= input.now.getTime())
      return { _tag: "expired" } as const;
    void history.remember(preset.snoozedUntil, input.now);
    return { _tag: "selected", preset } as const;
  }
  return resolveUpstreamSelection({
    ...input,
    presets: input.presets,
    displayedPresets: input.displayedPresets.filter(
      (choice): choice is SnoozePreset => !choice.id.startsWith("recent:"),
    ),
  });
}
