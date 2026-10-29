import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** The release pin does not replace an existing managed installation. */
export function checkAntigravityRuntime(version: string | null, instanceId: ProviderInstanceId) {
  return version !== null && /^v?1\.4\.[234](?:$|[-+])/.test(version)
    ? Effect.fail(
        new ProviderSetupError({
          instanceId,
          operation: "resolve",
          detail:
            `Antigravity ACP ${version} writes a run-workflow SKILL.md into session workspaces. ` +
            "In Settings > Providers on this environment, choose Update Antigravity to install 1.4.1. " +
            "If Binary path is set, replace that runtime with 1.4.1 yourself or clear the override first.",
        }),
      )
    : Effect.void;
}
