import { useAtomValue } from "@effect/atom-react";
import { environmentPresentations } from "../state/presentation";
import { CompactUsageControl } from "./CompactUsageControl";
import { compactUsageReport } from "./usageCompactReport";

export function SidebarUsageSummary({ onOpenFullView }: { onOpenFullView: () => void }) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  return (
    <CompactUsageControl
      {...compactUsageReport(presentations)}
      disconnected={[...presentations.values()].some(
        (presentation) => presentation.connection.phase !== "connected",
      )}
      onOpenFullView={onOpenFullView}
    />
  );
}
