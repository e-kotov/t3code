import * as Effect from "effect/Effect";
import { resolveAntigravityReleaseAsset } from "./antigravityRelease.ts";

export function antigravityQuotaUserAgent(
  version: string | null,
  platform: NodeJS.Platform,
  architecture: string,
) {
  const runtimeVersion =
    version ?? resolveAntigravityReleaseAsset(platform, architecture)?.version ?? "1.0.0";
  return `antigravity/acp/${runtimeVersion} (aidev_client; os_type=${platform}; arch=${architecture})`;
}

export function antigravityQuotaFamily(bucketId: string, groupName: string | undefined) {
  if (bucketId.startsWith("gemini-argon-")) return groupName?.trim() || "Gemini 4 Argon";
  return bucketId.startsWith("gemini-")
    ? "Gemini"
    : bucketId.startsWith("3p-")
      ? "Claude & GPT (shared)"
      : groupName?.trim() || bucketId;
}

/** A decoded empty summary is different from every endpoint failing. One policy per probe. */
export function antigravityQuotaSummaryPolicy(summaryOnly: boolean | undefined) {
  let received = false;
  return {
    decoded: Effect.sync(() => {
      received = true;
    }),
    unavailable: () => {
      const empty = summaryOnly && received;
      return {
        reason: empty ? ("unsupported" as const) : ("probeFailed" as const),
        message: empty
          ? "Antigravity reported no subscription quota windows for this account."
          : "Antigravity did not return usable quota information.",
      };
    },
  };
}
