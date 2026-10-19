import {
  createSlurmCountdownClock,
  slurmJobCountdownLabel,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { useEnvironmentPresentation } from "../state/presentation";

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

export function MachineGroupSlurmTime(props: { environmentId: EnvironmentId }) {
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  const status = presentation?.serverConfig?.slurmJobStatus;
  const connected = presentation?.connection.phase === "connected";
  const snapshot = () => slurmJobCountdownLabel(status, connected);
  const clockSubscribe = (listener: () => void) => (status ? subscribe(listener) : () => {});
  const label = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!label) return null;
  return (
    <span
      className="ml-1 whitespace-nowrap normal-case tabular-nums"
      title={`Slurm job ${status!.jobId}: ${label}. Scheduled walltime remaining.`}
    >
      {label}
    </span>
  );
}
