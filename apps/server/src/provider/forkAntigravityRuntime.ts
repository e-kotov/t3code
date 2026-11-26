import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { antigravityServesT3Code, OPEN_MODEL_ACCESS_RELEASE } from "./acp/AntigravityAcpSupport.ts";
import type { AntigravityExecutable, AntigravityInstallation } from "./AntigravityInstallation.ts";
import { brokenRuntimeError } from "./providerCompatibility.ts";

/** The release pin does not replace an existing managed installation. */
export function checkAntigravityRuntime(version: string | null, instanceId: ProviderInstanceId) {
  return version !== null && /^v?1\.4\.[234](?:$|[-+])/.test(version)
    ? Effect.fail(
        new ProviderSetupError({
          instanceId,
          operation: "resolve",
          detail:
            `Antigravity ACP ${version} writes a run-workflow SKILL.md into session workspaces. ` +
            "In Settings > Providers on this environment, choose Update Antigravity to install the supported Antigravity CLI. " +
            "If Binary path is set, replace that runtime with agy 1.5.12 or newer, or clear the override first.",
        }),
      )
    : Effect.void;
}

/** Use the same policy for resolved versions and versions reported by ACP initialize. */
export function makeAntigravityRuntimeCheck(
  instanceId: ProviderInstanceId,
  compatibility: AntigravityInstallation["Service"]["compatibility"],
) {
  return Effect.fn("AntigravityDriver.checkRuntime")(function* (
    executable: AntigravityExecutable,
    version: string | null = executable.version,
  ) {
    if (!version) return;
    yield* checkAntigravityRuntime(version, instanceId);
    const advisory = yield* compatibility(version);
    const action =
      executable.source === "managed"
        ? "Update it in Antigravity setup"
        : `Update the Antigravity executable at ${executable.executablePath}`;
    const refused = brokenRuntimeError({
      instanceId,
      name: "Antigravity",
      version,
      advisory,
      action,
    });
    if (refused) return yield* refused;
    if (!antigravityServesT3Code(version)) {
      return yield* new ProviderSetupError({
        instanceId,
        operation: "runtime",
        detail: `Antigravity ${version} only serves allowlisted editors, not T3 Code. ${action} to ${OPEN_MODEL_ACCESS_RELEASE.join(".")} or newer, then retry.`,
      });
    }
  });
}
