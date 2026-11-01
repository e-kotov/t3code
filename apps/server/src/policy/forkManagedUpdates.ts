import type { ManagedPolicyDocument } from "@t3tools/contracts";
import type { CliReleaseChannel } from "@t3tools/shared/forkCliRelease";
import { managedUpdateRefusal as upstreamUpdateRefusal } from "./managedUpdates.ts";

export function managedUpdateRefusal(
  document: ManagedPolicyDocument | undefined,
  targetChannel?: CliReleaseChannel,
): string | undefined {
  return upstreamUpdateRefusal(document, targetChannel === "ek" ? "nightly" : targetChannel);
}
