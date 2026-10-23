# Fork releases

For installation, signing and platform testing limits, see [Install T3 Code EK](../user/fork-install.md).

This fork publishes installers from `.github/workflows/release-fork.yml` using
GitHub-hosted runners. No upstream Blacksmith, Expo/EAS, Cloudflare or npm
publishing account is required.

## Artifacts

- Mac Apple Silicon only (no Intel builds): DMG and ZIP. Builds are unsigned/not notarized;
  macOS may require approval in Privacy & Security on first launch.
- Android: standalone signed ARM64 APK (`-arm64.apk`), package `pro.ekotov.t3code`,
  labelled T3 Code EK. Targets ARM64 phones including Galaxy S23+; x86 emulators
  and 32-bit phones are excluded. Only ARM64 native code is compiled.
  It installs alongside upstream. Pair the fork app with your existing server;
  upstream app data is not automatically transferred. Expo OTA updates are disabled.
- Linux x64: `t3-VERSION-linux-x64.tar.gz`, including the executable, native
  dependencies, resource monitor and web client; suitable for the GWDG workstation.
- Native Termux ARM64: `t3-VERSION-termux-arm64.tar.gz` and its `.sha256` file.
  Contains server/web JavaScript, locked npm dependencies and patches; the Termux
  dotfiles updater installs Android dependencies and compiles the PTY on the phone.
- `SHA256SUMS` for downloaded assets.

Set `T3CODE_ENVIRONMENT_LABEL` in a server's environment to give it a fixed name, for
example `GWDG` for a server whose Slurm job lands on different nodes. Without it the
server is named after its host. Clients rename a saved environment to the name its server
reports on every connect, so a name typed into a client does not stick.

Use the existing SSH or private Tailscale endpoint in Add Environment. These builds
have no upstream cloud account/relay configuration. Desktop native update checking
is disabled; use the Homebrew tap below.
Product analytics are off by default, including in local development.
`T3CODE_TELEMETRY_ENABLED=true` explicitly opts a server into PostHog analytics.
For an older installed build, set `T3CODE_TELEMETRY_ENABLED=false` and restart it.

## Installing on a Mac with Homebrew

Install and upgrade the Mac app from the `e-kotov/tap` cask:

```sh
brew install --cask e-kotov/tap/t3-code-ek
brew upgrade --cask t3-code-ek
```

The cask pins each DMG's SHA-256, re-signs `T3 Code EK.app` ad hoc after
install and clears its quarantine flag. This is not Apple notarization. When
replacing upstream's `t3-code` cask, uninstall it without `--zap` so T3 data is
retained, and remove it from any managed Homebrew package list.

## Updating the server/CLI

`t3 update` checks `e-kotov/t3code` and defaults to the `ek` channel, which
selects the highest published `vX.Y.Z-ek.N` prerelease. Drafts and upstream
nightly/preview tags are excluded. Downloads and `SHA256SUMS` come from the same
fork release. `--version X.Y.Z-ek.N` pins a release; `T3CODE_RELEASE_BASE_URL`
can still override the download origin for a mirror.

On the phone, apply Egor's Termux dotfiles, then use `t3-termux update` instead.
It selects the newest published EK release with a Termux asset, verifies its checksum,
prepares the runtime, and restarts a running server with the same state and pairing.
`t3-termux update --check` only checks availability; a positional version pins the update.
The Android APK is a separate client update. Full phone installation verification is
performed on the device, not by the Linux packaging job.

To add a Termux asset to a release made before this packaging was introduced, dispatch
**Publish Termux server from existing build** (`release-termux.yml`) with its successful
fork-release `run_id` and version. It checks the tag against the source run, uses that
run's `js-bundle` plus matching source lockfile/patches, and uploads the archive and
separate checksum without replacing existing assets. The source artifact must still
be available (normally three days). Future full releases include Termux automatically.

## Nightly prereleases

`nightly-fork.yml` attempts a release at 04:47 UTC each day. It skips a commit that already
has a published EK release. For a changed candidate it runs the seven package typechecks,
selected fork/upstream regression tests and edit-budget gate, then creates an annotated tag
and dispatches `release-fork.yml`. GitHub may delay scheduled starts.

Nightlies retain `vX.Y.Z-ek.N` tags and GitHub's prerelease flag. `X.Y.Z` comes from the newest
upstream nightly incorporated into the candidate; `N` exceeds every existing tag for that
base, including tags from failed builds. The release title identifies the nightly date.
The updater and Homebrew cask therefore keep recognizing the same version scheme.

Every platform builds the exact checked commit, even if main advances while the release is
queued. Publication requires that commit to belong to main and match the existing tag. All
platforms must pass before publication; the cask then advances through the usual job.
Installation remains manual.

To run the nightly path now, use
`gh workflow run nightly-fork.yml --ref main -f publish=true`.
Omit `publish` for a dry run: it plans and validates a changed candidate without tagging or
building installers. An already released candidate skips validation too.

## Release

Push a tag such as `v0.0.45-ek.1` at the head of `main` with your own Git
credentials, then dispatch **Fork release** on `main` with version `0.0.45-ek.1`
and `publish` selected:

```sh
git tag v0.0.45-ek.1 && git push origin v0.0.45-ek.1
gh workflow run release-fork.yml --ref main -f version=0.0.45-ek.1 -f publish=true
```

Pushing the tag does not start a build. Releases run on `main` because Actions
caches saved under a tag are invisible to the next tag, so tag-triggered runs
rebuilt Android from a cold Gradle cache every time; runs on `main` save caches
that the next release reads. Without `publish` a run only uploads Actions
artifacts (a test build; it needs no tag). Publication requires the version tag
to point at the build commit, which avoids relying on the Actions token to
create a release tag at a commit that changes workflow files. The optional `commit` input pins a full main commit SHA; when omitted, the dispatch commit is
built. Missing or mismatched tags fail before compilation. Every platform must build
successfully before publication. Use a new version for every published release.

`X.Y.Z` is the version of upstream's newest `vX.Y.Z-nightly.*` tag merged into
`main`; `N` starts at 1 for each new `X.Y.Z` and only increases. Never reuse a
tag, including one whose build failed.

After publication, the `homebrew_tap` job points `e-kotov/tap`'s `t3-code-ek`
cask at the new release, taking the Apple Silicon DMG checksum from `SHA256SUMS`. It
only moves the cask forward, never to an older version, and never installs
anything. It pushes with the `HOMEBREW_TAP_DEPLOY_KEY` secret, the private half
of a write deploy key on `e-kotov/homebrew-tap`; without that secret the job
warns and skips. To rotate it, add a new deploy key, replace the secret, then
delete the old key.

If publication fails after installers were collected, dispatch **Publish existing
fork installers** with the original run ID and version. It verifies the tag's
commit against the build, downloads `release-installers`, checks every SHA-256,
and publishes without recompiling. Publication verifies the existing tag rather
than asking the workflow token to create one with a target commit.

For an older universal APK, **Slim existing Android APK to ARM64** removes the
other three native architectures and signs with the same fork key. It checks
source checksums, matching signing certificates, alignment and ARM64-only
libraries, then adds `-arm64.apk` and `SHA256SUMS-arm64` to the existing release.
Version/package/data remain compatible; use `SHA256SUMS-arm64` for this added APK.

## Android signing

The repository needs three encrypted Actions secrets: `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_PASSWORD`. The PKCS12 keystore
contains alias `t3code-ek`. Keep the same key across releases so APKs update
in place. Never commit the key or passwords. The initial key is configured in this
fork's repository secrets; preserve those secrets when migrating the repository.

The APK's versionCode is the workflow run number. Do not move release building
to a new workflow without maintaining a higher versionCode than installed APKs.
Apple signing/notarization and iOS distribution require separate credentials;
iOS is outside this Mac/Android/GWDG release workflow.

## Android built-in Tailscale

The APK embeds a Tailscale node (`apps/mobile/modules/t3-tailnet`). Before Gradle,
the Android job runs its Go tests and `scripts/build-tailnet-android.sh`, which
cross-compiles `libt3tailnet.so` for arm64 with Go and the runner's NDK into the
module's uncommitted `jniLibs`. A local build without that library still works; its
Settings report that built-in Tailscale is not part of the build.

## Android build caching

Android uses the Gradle action to retain dependency downloads, transformed JARs
and the local task-output build cache. `--build-cache` enables reuse of cacheable
task outputs. A separate 3 GB ccache retains C/C++ compiler results; the installed
React Native CMake files detect ccache automatically. Each build prints ccache
hit/miss statistics in its job summary. Compiler contents and source inputs are
validated by ccache, including when a fallback key restores an older entry.

The first cache-enabled run is still cold. For the most reusable cache, dispatch
release builds from `main`: GitHub exposes default-branch caches to later tag
builds, while a cache created only on one release tag is not shared with other
tags. The pipeline still regenerates Android with Expo prebuild; it retains
compiled results outside that generated directory. Actual warm-run timings must
be measured after a successful cache-producing build.
