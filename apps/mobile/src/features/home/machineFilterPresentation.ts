import {
  slurmJobCountdownLabel,
  type EnvironmentConnectionPhase,
  type EnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ColorValue } from "react-native";
import { formatFilterOptionSubtitle, formatFilterOptionTitle } from "./mobileNonSettledCounts";

export interface MachineFilterDetails {
  readonly filterConnectionStatus?: {
    readonly label: string;
    readonly phase: EnvironmentConnectionPhase;
    readonly color: ColorValue;
  } | null;
  readonly slurmTimeRemaining?: string | null;
}

export function machineFilterOptionPresentation(
  environment: MachineFilterDetails & { readonly label: string; readonly nonSettledCount?: number },
) {
  const count = formatFilterOptionSubtitle(environment.nonSettledCount);
  const status = environment.filterConnectionStatus;
  const subtitle = [status?.label, count].filter(Boolean).join(" · ");
  return {
    title: [
      formatFilterOptionTitle(environment.label, environment.nonSettledCount),
      environment.slurmTimeRemaining,
    ]
      .filter(Boolean)
      .join(" · "),
    ...(subtitle ? { subtitle } : {}),
    ...(status ? { icon: "circle.fill", iconColor: status.color } : {}),
  };
}

export function nativeMachineFilterOptionPresentation(
  environment: Parameters<typeof machineFilterOptionPresentation>[0],
) {
  const { icon, iconColor, ...presentation } = machineFilterOptionPresentation(environment);
  return { ...presentation, ...(icon ? { image: icon, imageColor: iconColor } : {}) };
}

export function machineFilterEnvironmentId(action: {
  readonly id?: string;
  readonly image?: string;
}) {
  if (action.image !== "circle.fill" || !action.id) return undefined;
  for (const prefix of ["environment:", "machine-filter:"]) {
    if (action.id.startsWith(prefix)) {
      const id = action.id.slice(prefix.length);
      return id && id !== "all" ? id : undefined;
    }
  }
  return undefined;
}

export function machineFilterActionId(environmentId: string) {
  return `machine-filter:${environmentId}`;
}

export function machineFilterCountdownSnapshot(
  environments: readonly { readonly environmentId: EnvironmentId }[],
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
) {
  return environments
    .map((environment) => {
      const presentation = presentations.get(environment.environmentId);
      return (
        slurmJobCountdownLabel(
          presentation?.serverConfig?.slurmJobStatus,
          presentation?.connection.phase === "connected",
        ) ?? ""
      );
    })
    .join("\n");
}

export function hasMachineFilterCountdown(
  environments: readonly { readonly environmentId: EnvironmentId }[],
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
) {
  return environments.some((environment) =>
    Boolean(presentations.get(environment.environmentId)?.serverConfig?.slurmJobStatus),
  );
}
