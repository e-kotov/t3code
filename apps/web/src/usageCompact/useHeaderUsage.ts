import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { environmentPresentations } from "../state/presentation";
import { compactUsageReport } from "./usageCompactReport";

export function useHeaderUsage() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const navigate = useNavigate();
  return {
    ...compactUsageReport(presentations),
    disconnected: [...presentations.values()].some(
      (presentation) => presentation.connection.phase !== "connected",
    ),
    onOpenFullView: () => void navigate({ to: "/usage" }),
  };
}
