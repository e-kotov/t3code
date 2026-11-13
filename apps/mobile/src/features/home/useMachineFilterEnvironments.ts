import { useAtomValue } from "@effect/atom-react";
import {
  createSlurmCountdownClock,
  machineGroupConnectionStatus,
  slurmJobCountdownLabel,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { environmentPresentations } from "../../state/presentation";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import type { MachineFilterDetails } from "./machineFilterPresentation";

const subscribe = createSlurmCountdownClock(
  () => AppState.currentState === "active",
  (refresh) => {
    const subscription = AppState.addEventListener("change", refresh);
    return () => subscription.remove();
  },
);

export function useMachineFilterEnvironments<T extends {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState?: EnvironmentConnectionPhase;
}>(environments: readonly T[]): (T & MachineFilterDetails)[] {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const { themeVariables } = useAppearancePreferences();
  const snapshot = useCallback(
    () =>
      environments.map((environment) => {
        const presentation = presentations.get(environment.environmentId);
        return slurmJobCountdownLabel(
          presentation?.serverConfig?.slurmJobStatus,
          presentation?.connection.phase === "connected",
        ) ?? "";
      }).join("\n"),
    [environments, presentations],
  );
  const clockSubscribe = useCallback(
    (listener: () => void) =>
      environments.some((environment) =>
        presentations.get(environment.environmentId)?.serverConfig?.slurmJobStatus,
      ) ? subscribe(listener) : () => {},
    [environments, presentations],
  );
  const countdowns = useSyncExternalStore(clockSubscribe, snapshot, snapshot).split("\n");
  return environments.map((environment, index) => {
    const presentation = presentations.get(environment.environmentId);
    const phase = presentation?.connection.phase ?? environment.connectionState;
    const status = machineGroupConnectionStatus(environment.label, phase);
    const color = phase === "connecting" || phase === "reconnecting"
      ? themeVariables["--color-warning-foreground"]
      : phase === "offline" || phase === "error"
        ? themeVariables["--color-danger-foreground"]
        : themeVariables["--color-icon-muted"];
    return {
      ...environment,
      filterConnectionStatus: status && phase ? { label: status.label, phase, color } : null,
      slurmTimeRemaining: countdowns[index] || null,
    };
  });
}
