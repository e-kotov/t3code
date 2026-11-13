import { useClientSettings } from "../../hooks/useSettings";
import { planSettleNavigation, type SettleNavigationTargets } from "./settleNavigation.logic";

/** Wraps the sidebar's next-thread plan with the user's choice for settling the open thread. */
export function useSettleNavigation(
  planForwardNavigation: SettleNavigationTargets["planForwardNavigation"],
  threadByKeyRef: SettleNavigationTargets["threadByKeyRef"],
  handleNewThread: SettleNavigationTargets["handleNewThread"],
) {
  const mode = useClientSettings((settings) => settings.settleNavigation);
  return (threadKey: string, coSettlingKeys?: ReadonlySet<string>) =>
    planSettleNavigation(
      mode,
      { planForwardNavigation, threadByKeyRef, handleNewThread },
      threadKey,
      coSettlingKeys,
    );
}
