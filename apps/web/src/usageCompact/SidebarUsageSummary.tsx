import { useAtomValue } from "@effect/atom-react";
import { collectLimitAccounts } from "@t3tools/shared/usageLimits";
import { environmentPresentations } from "../state/presentation";
import { CompactUsageControl } from "./CompactUsageControl";

export function SidebarUsageSummary({ onOpenFullView }: { onOpenFullView: () => void }) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  return (
    <CompactUsageControl
      accounts={collectLimitAccounts(presentations)}
      disconnected={[...presentations.values()].some(
        (presentation) => presentation.connection.phase !== "connected",
      )}
      onOpenFullView={onOpenFullView}
    />
  );
}
