import { describe, expect, it } from "vite-plus/test";
import {
  cliReleaseChannelOf,
  cliReleaseDownloadBaseUrl,
  cliReleaseIndexPageUrl,
  DEFAULT_FORK_RELEASE_CHANNEL,
  newestCliReleaseVersion,
} from "./forkCliRelease.ts";

describe("EK release updates", () => {
  it("uses the fork for discovery and archive downloads, retaining mirror overrides", () => {
    expect(DEFAULT_FORK_RELEASE_CHANNEL).toBe("ek");
    expect(cliReleaseIndexPageUrl(2)).toBe(
      "https://api.github.com/repos/e-kotov/t3code/releases?per_page=100&page=2",
    );
    expect(cliReleaseDownloadBaseUrl("0.0.46-ek.8")).toBe(
      "https://github.com/e-kotov/t3code/releases/download/v0.0.46-ek.8",
    );
    expect(cliReleaseDownloadBaseUrl("0.0.46-ek.8", "https://mirror.example/t3/")).toBe(
      "https://mirror.example/t3/v0.0.46-ek.8",
    );
    expect(cliReleaseDownloadBaseUrl("0.0.46-ek.8", " ")).toContain("e-kotov/t3code");
  });

  it("recognizes numbered EK prereleases without treating upstream nightlies as EK", () => {
    expect(cliReleaseChannelOf("0.0.46-ek.8")).toBe("ek");
    expect(cliReleaseChannelOf("0.0.46-nightly.20261014.1")).toBe("nightly");
    expect(cliReleaseChannelOf("0.0.46-preview.20261014.1")).toBe("preview");
    expect(cliReleaseChannelOf("0.0.46")).toBe("stable");
  });

  it("selects the highest base version and numeric EK revision regardless of publication order", () => {
    const releases = [
      { tag_name: "v0.0.46-ek.9" },
      { tag_name: "v0.0.46-ek.11", draft: true },
      { tag_name: "v0.0.46-ek.10" },
      { tag_name: "v0.0.45-ek.999" },
      { tag_name: "v9.0.0-nightly.20261014.1" },
      { tag_name: "v9.0.0-preview.20261014.1" },
      { tag_name: "v9.0.0" },
      { tag_name: "v9.0.0-ek.12-extra" },
      { tag_name: "v9.0.0-rc.1" },
    ];
    expect(newestCliReleaseVersion(releases, "ek")).toBe("0.0.46-ek.10");
    expect(newestCliReleaseVersion([...releases, { tag_name: "v0.0.47-ek.1" }], "ek")).toBe(
      "0.0.47-ek.1",
    );
    expect(newestCliReleaseVersion([{ tag_name: "v9.0.0" }], "ek")).toBeUndefined();
  });

  it("accepts date counters and selects them above legacy revisions", () => {
    expect(cliReleaseChannelOf("0.1.3-ek.202610260001")).toBe("ek");
    expect(
      newestCliReleaseVersion(
        [
          { tag_name: "v0.1.3-ek.12" },
          { tag_name: "v0.1.3-ek.202610260010" },
          { tag_name: "v0.1.3-ek.202610260009" },
          { tag_name: "v0.1.3-ek.202610270001", draft: true },
        ],
        "ek",
      ),
    ).toBe("0.1.3-ek.202610260010");
  });

  it("allows an explicit stable or nightly selection within the fork index", () => {
    const releases = [
      { tag_name: "v0.0.46-ek.8" },
      { tag_name: "v0.0.46-nightly.20261014.1" },
      { tag_name: "v0.0.46" },
    ];
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("0.0.46-nightly.20261014.1");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("0.0.46");
  });
});
