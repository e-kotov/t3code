import {
  createSlurmCountdownClock,
  slurmJobCountdownLabel,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { useEnvironmentPresentation } from "../state/presentation";
import { cn } from "../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const subscribe = createSlurmCountdownClock(
  () => document.visibilityState === "visible",
  (refresh) => {
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  },
);

export function MachineGroupSlurmTime(props: {
  readonly environmentId: EnvironmentId;
  readonly className?: string;
}) {
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const status = presentation?.serverConfig?.slurmJobStatus;
  const connected = presentation?.connection.phase === "connected";
  const snapshot = () => slurmJobCountdownLabel(status, connected);
  const clockSubscribe = (listener: () => void) => (status ? subscribe(listener) : () => {});
  const label = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!label) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn("ml-1 whitespace-nowrap normal-case tabular-nums", props.className)}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipPopup side="top">
        Slurm job {status!.jobId}: {label}. Scheduled walltime remaining.
      </TooltipPopup>
    </Tooltip>
  );
}
