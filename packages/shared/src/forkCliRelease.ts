import * as UpstreamRelease from "./cliRelease.ts";

export {
  CLI_RELEASE_BASE_URL_ENV,
  CLI_RELEASE_CHECKSUMS_FILE,
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliArchiveTarCommand,
  parseChecksums,
} from "./cliRelease.ts";

export const FORK_RELEASE_REPOSITORY = "e-kotov/t3code";
const FORK_RELEASE_DOWNLOAD_BASE_URL = `https://github.com/${FORK_RELEASE_REPOSITORY}/releases/download`;
export const DEFAULT_FORK_RELEASE_CHANNEL = "ek";
export type CliReleaseChannel = UpstreamRelease.CliReleaseChannel | "ek";
export const CLI_RELEASE_CHANNELS: ReadonlyArray<CliReleaseChannel> = [
  "ek",
  ...UpstreamRelease.CLI_RELEASE_CHANNELS,
];

const EK_VERSION = /^(\d+)\.(\d+)\.(\d+)-ek\.(\d+)$/;

export function cliReleaseChannelOf(version: string): CliReleaseChannel {
  return EK_VERSION.test(version) ? "ek" : UpstreamRelease.cliReleaseChannelOf(version);
}

export function cliReleaseDownloadBaseUrl(version: string, baseUrl?: string): string {
  return UpstreamRelease.cliReleaseDownloadBaseUrl(
    version,
    baseUrl?.trim() || FORK_RELEASE_DOWNLOAD_BASE_URL,
  );
}

export function cliReleaseIndexPageUrl(page: number): string {
  return `https://api.github.com/repos/${FORK_RELEASE_REPOSITORY}/releases?per_page=100&page=${page}`;
}

export function newestCliReleaseVersion(
  releases: Parameters<typeof UpstreamRelease.newestCliReleaseVersion>[0],
  channel: CliReleaseChannel,
): string | undefined {
  if (channel !== "ek") {
    return UpstreamRelease.newestCliReleaseVersion(
      releases.filter((release) => !EK_VERSION.test(release.tag_name.slice(1))),
      channel,
    );
  }

  // Publication can finish out of order. Compare the base version and the
  // numeric EK revision instead of trusting GitHub's release creation order.
  let newest: { version: string; parts: ReadonlyArray<bigint> } | undefined;
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith("v")) continue;
    const version = release.tag_name.slice(1);
    const match = EK_VERSION.exec(version);
    if (!match) continue;
    const parts = match.slice(1).map((part) => BigInt(part));
    const difference = parts
      .map((part, index) => part - (newest?.parts[index] ?? 0n))
      .find((part) => part !== 0n);
    if (!newest || (difference ?? 0n) > 0n) {
      newest = { version, parts };
    }
  }
  return newest?.version;
}
