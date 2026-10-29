import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { environmentPresentations } from "../state/presentation";
import { compactUsageReport, disconnectedEnvironmentLabels } from "./usageCompactReport";

export function useHeaderUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const navigate = useNavigate();
  return {
    ...compactUsageReport(presentations),
    disconnected: disconnectedEnvironmentLabels(presentations.values()),
    onOpenFullView: () => void navigate({ to: "/usage" }),
  };
}
