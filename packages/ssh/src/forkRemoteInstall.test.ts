import { describe, expect, it } from "@effect/vitest";
import { buildRemoteT3RunnerScript } from "./tunnel.ts";

describe("fork SSH provisioning", () => {
  it("downloads the exact desktop EK version from the fork, with checksums", () => {
    const script = buildRemoteT3RunnerScript({ archiveVersion: "2.1.0-ek.7" });
    expect(script).toContain("T3_ARCHIVE_VERSION='2.1.0-ek.7'");
    expect(script).toContain("T3_RELEASE_BASE_URL='https://github.com/e-kotov/t3code/releases/download'");
    expect(script).not.toContain("github.com/pingdotgg/t3code");
    expect(script).toContain('$T3_RELEASE_BASE_URL/v$T3_ARCHIVE_VERSION/SHA256SUMS');
    expect(script).toContain('$T3_RELEASE_BASE_URL/v$T3_ARCHIVE_VERSION/$T3_ARCHIVE');
    expect(script).toContain('"$T3_ACTUAL" != "$T3_EXPECTED"');
  });

  it("keeps an explicitly supplied download mirror", () => {
    const script = buildRemoteT3RunnerScript({ archiveVersion: "2.1.0-ek.7", releaseBaseUrl: "https://mirror.example/t3/" });
    expect(script).toContain("T3_RELEASE_BASE_URL='https://mirror.example/t3'");
  });
});
