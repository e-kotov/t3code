import type { EnvironmentConnectionPhase } from "./presentation.ts";

/** A healthy machine needs no extra decoration in the conversation list. */
export function machineGroupConnectionStatus(
  label: string,
  phase: EnvironmentConnectionPhase | undefined,
) {
  switch (phase) {
    case "connecting":
      return { label: `${label} is connecting`, pulse: true };
    case "reconnecting":
      return { label: `${label} is reconnecting`, pulse: true };
    case "offline":
      return { label: `${label} is offline`, pulse: false };
    case "error":
      return { label: `Connection to ${label} failed`, pulse: false };
    case "unsupported":
      return { label: `${label} requires a compatible client`, pulse: false };
    case "available":
      return { label: `${label} is not connected`, pulse: false };
    case "connected":
    case undefined:
      return null;
  }
}
