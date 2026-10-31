import * as Effect from "effect/Effect";
import { resolveAntigravityReleaseAsset } from "./antigravityRelease.ts";

export function antigravityQuotaUserAgent(
  input: { readonly runtimeVersion?: Effect.Effect<string | null> },
  platform: NodeJS.Platform,
  architecture: string,
) {
  // Without the fork's runtime version, keep upstream's hub identity.
  if (input.runtimeVersion === undefined) {
    return Effect.succeed(
      `antigravity/hub/2.24.0 (aidev_client; os_type=${platform}; arch=${architecture}; cl=963137146)`,
    );
  }
  return input.runtimeVersion.pipe(
    Effect.map((version) => {
      const runtimeVersion =
        version ?? resolveAntigravityReleaseAsset(platform, architecture)?.version ?? "1.0.0";
      return `antigravity/acp/${runtimeVersion} (aidev_client; os_type=${platform}; arch=${architecture})`;
    }),
  );
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
