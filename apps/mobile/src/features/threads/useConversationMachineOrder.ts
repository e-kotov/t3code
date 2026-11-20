import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomValue } from "@effect/atom-react";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { moveMachineInOrder } from "./conversationListOrder";

/** The saved machine group order and the move handler for machine group headers. */
export function useConversationMachineOrder(
  environments: ReadonlyArray<{ readonly environmentId: string }>,
) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const updatePreferences = useAtomCommand(saveMobilePreferences);
  const machineOrder =
    preferencesResult._tag === "Success"
      ? (preferencesResult.value.conversationMachineOrder ?? [])
      : [];
  const moveMachine = (environmentId: string, delta: -1 | 1) => {
    const ordered = moveMachineInOrder(
      environments.map((environment) => String(environment.environmentId)),
      machineOrder,
      environmentId,
      delta,
    );
    if (ordered) updatePreferences({ conversationMachineOrder: ordered });
  };
  return { machineOrder, moveMachine } as const;
}
