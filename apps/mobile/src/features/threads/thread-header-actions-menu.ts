import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";

type ThreadHeaderActionsMenu = AppBarMenu;
type ThreadHeaderPlacement = "active" | "settled" | "snoozed";

export function resolveThreadHeaderPlacement(
  thread: EnvironmentThreadShell,
  input: {
    readonly now: string;
    readonly settlementSupported: boolean;
    readonly snoozeSupported: boolean;
  },
): ThreadHeaderPlacement {
  if (input.snoozeSupported && effectiveSnoozed(thread, { now: input.now })) return "snoozed";
  if (input.settlementSupported && thread.settledOverride === "settled") return "settled";
  return "active";
}

export function buildThreadHeaderActionsMenu(input: {
  readonly placement: ThreadHeaderPlacement;
  readonly settlementSupported: boolean;
  /** `null` when the thread cannot be snoozed right now. */
  readonly snoozeChoices: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly whenLabel: string;
  }> | null;
  readonly titleRegeneration: "unsupported" | "idle" | "regenerating";
  readonly onSettle: () => void;
  readonly onUnsettle: () => void;
  readonly onWake: () => void;
  readonly onSnooze: (choiceId: string) => void;
  readonly onCustomSnooze: () => void;
  readonly onRename: () => void;
  readonly onRegenerateTitle: () => void;
}): ThreadHeaderActionsMenu {
  const placementItems: AppBarMenuItem[] =
    input.placement === "snoozed"
      ? [{ id: "unsnooze", title: "Wake thread", icon: "clock", onPress: input.onWake }]
      : input.placement === "settled"
        ? [
            {
              id: "unsettle",
              title: "Un-settle",
              icon: "arrow.uturn.backward",
              onPress: input.onUnsettle,
            },
          ]
        : [
            ...(input.settlementSupported
              ? [{ id: "settle", title: "Settle", icon: "checkmark", onPress: input.onSettle }]
              : []),
            ...(input.snoozeChoices
              ? [
                  {
                    id: "snooze",
                    title: "Snooze",
                    icon: "clock",
                    items: [
                      ...input.snoozeChoices.map((choice) => ({
                        id: `snooze:${choice.id}`,
                        title: choice.label,
                        subtitle: choice.whenLabel,
                        onPress: () => input.onSnooze(choice.id),
                      })),
                      { id: "snooze:custom", title: "Custom…", onPress: input.onCustomSnooze },
                    ],
                  },
                ]
              : []),
          ];
  return {
    title: "Thread actions",
    icon: "ellipsis.circle",
    items: [
      ...placementItems,
      { id: "rename", title: "Rename", icon: "square.and.pencil", onPress: input.onRename },
      ...(input.titleRegeneration === "unsupported"
        ? []
        : [
            {
              id: "regenerate-title",
              title:
                input.titleRegeneration === "regenerating" ? "Regenerating…" : "Regenerate title",
              icon: "arrow.clockwise",
              disabled: input.titleRegeneration === "regenerating",
              onPress: input.onRegenerateTitle,
            },
          ]),
    ],
  };
}
