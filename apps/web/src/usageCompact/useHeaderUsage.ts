import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { environmentPresentations } from "../state/presentation";
import { compactUsageReport, disconnectedEnvironmentLabels } from "./usageCompactReport";
import { useActiveComposerSelection } from "./useActiveComposerSelection";

export function useHeaderUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const { activeModel, activeDriver } = useActiveComposerSelection(presentations);
  const navigate = useNavigate();
  return {
    ...compactUsageReport(presentations),
    activeModel,
    activeDriver,
    disconnected: disconnectedEnvironmentLabels(presentations.values()),
    onOpenFullView: () => void navigate({ to: "/usage" }),
  };
}
