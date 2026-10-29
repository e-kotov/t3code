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
