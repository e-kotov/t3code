import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import type { EnvironmentConnectionPhase } from "./presentation.ts";

/** A healthy machine needs no extra decoration in the conversation list. */
export function machineGroupConnectionStatus(
  label: string,
  phase: EnvironmentConnectionPhase | undefined,
  resolve: MFunctionType = mFallback,
) {
  switch (phase) {
    case "connecting":
      return { label: resolve(msg("{label} is connecting"), { label }), pulse: true };
    case "reconnecting":
      return { label: resolve(msg("{label} is reconnecting"), { label }), pulse: true };
    case "offline":
      return { label: resolve(msg("{label} is offline"), { label }), pulse: false };
    case "error":
      return { label: resolve(msg("Connection to {label} failed"), { label }), pulse: false };
    case "unsupported":
      return {
        label: resolve(msg("{label} requires a compatible client"), { label }),
        pulse: false,
      };
    case "available":
      return { label: resolve(msg("{label} is not connected"), { label }), pulse: false };
    case "connected":
    case undefined:
      return null;
  }
}
