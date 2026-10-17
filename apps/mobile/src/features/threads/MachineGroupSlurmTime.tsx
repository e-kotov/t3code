import {
  createSlurmCountdownClock,
  slurmJobCountdownLabel,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { useEnvironmentPresentation } from "../../state/presentation";

const subscribe = createSlurmCountdownClock(
  () => AppState.currentState === "active",
  (refresh) => {
    const subscription = AppState.addEventListener("change", refresh);
    return () => subscription.remove();
  },
);

export function MachineGroupSlurmTime(props: { readonly environmentId?: string }) {
  const { presentation } = useEnvironmentPresentation(
    props.environmentId ? EnvironmentId.make(props.environmentId) : null,
  );
  const status = presentation?.serverConfig?.slurmJobStatus;
  const connected = presentation?.connection.phase === "connected";
  const snapshot = useCallback(
    () => slurmJobCountdownLabel(status, connected),
    [status, connected],
  );
  const clockSubscribe = useCallback(
    (listener: () => void) => (status ? subscribe(listener) : () => {}),
    [status],
  );
  const label = useSyncExternalStore(clockSubscribe, snapshot, snapshot);
  if (!label) return null;
  return (
    <AppText
      accessibilityLabel={`Slurm job ${status!.jobId}: ${label}. Scheduled walltime remaining.`}
    >{` ${label}`}</AppText>
  );
}
