import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import { useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { useNowAfter, useNowMinuteMs } from "../../lib/clock";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { useThreadListActions } from "../home/useThreadListActions";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { resolveThreadListV2SnoozeMenuSelection, useSnoozePresets } from "./recentCustomSnoozes";
import {
  buildThreadHeaderActionsMenu,
  resolveThreadHeaderPlacement,
} from "./thread-header-actions-menu";
import { resolveThreadListV2SnoozeGateExpiryMs } from "./threadListV2";

/** Settle, snooze and title actions for the open thread, matching its list row. */
export function useThreadHeaderActionsMenu(thread: EnvironmentThreadShell) {
  const actions = useThreadListActions();
  const environments = useAtomValue(threadListEnvironmentsAtom);
  const threadKey = `${thread.environmentId}:${thread.id}`;
  const [customSnoozeKey, setCustomSnoozeKey] = useState<string | null>(null);
  const now = new Date(useNowMinuteMs()).toISOString();
  const settlementSupported = environments.settlementEnvironmentIds.has(thread.environmentId);
  const snoozeSupported = environments.snoozeEnvironmentIds.has(thread.environmentId);
  const presets = environments.snoozePresetsByEnvironmentId.get(thread.environmentId);
  const placement = resolveThreadHeaderPlacement(thread, {
    now,
    settlementSupported,
    snoozeSupported,
  });
  // Same gate as the list row: only the queued-turn grace window expires on its own.
  const snoozeGateExpiryMs = snoozeSupported
    ? resolveThreadListV2SnoozeGateExpiryMs(thread, { now: thread.latestUserMessageAt ?? "" })
    : null;
  const snoozeGateNowMs = useNowAfter(snoozeGateExpiryMs === null ? null : snoozeGateExpiryMs + 1);
  const snoozable =
    snoozeSupported &&
    placement === "active" &&
    canSnooze(thread, { now: new Date(snoozeGateNowMs).toISOString() });
  const snoozeChoices = useSnoozePresets(snoozable, now, presets);

  const menu = buildThreadHeaderActionsMenu({
    placement,
    settlementSupported,
    snoozeChoices: snoozable ? snoozeChoices : null,
    titleRegeneration: !environments.titleRegenerationEnvironmentIds.has(thread.environmentId)
      ? "unsupported"
      : thread.titleRegeneration != null
        ? "regenerating"
        : "idle",
    onSettle: () => void actions.settleThread(thread),
    onUnsettle: () => void actions.unsettleThread(thread),
    onWake: () => void actions.unsnoozeThread(thread),
    onSnooze: (choiceId) => {
      const selection = resolveThreadListV2SnoozeMenuSelection({
        event: `snooze:${choiceId}`,
        displayedPresets: snoozeChoices,
        now: new Date(),
        presets,
      });
      if (selection._tag === "selected") {
        void actions.snoozeThread(thread, selection.preset.snoozedUntil);
      } else if (selection._tag === "expired") {
        Dialog.alert(
          "Could not snooze thread",
          "That snooze time has passed. Choose another time.",
        );
      }
    },
    onCustomSnooze: () => setCustomSnoozeKey(threadKey),
    onRename: () => actions.renameThread(thread),
    onRegenerateTitle: () => void actions.regenerateThreadTitle(thread),
  });
  const sheet =
    customSnoozeKey === threadKey ? (
      <CustomSnoozeSheet
        onClose={() => setCustomSnoozeKey(null)}
        onSnooze={(snoozedUntil) => void actions.snoozeThread(thread, snoozedUntil)}
      />
    ) : null;
  return { menu, sheet };
}
