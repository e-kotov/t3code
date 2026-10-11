# Fork releases

This fork publishes installers from `.github/workflows/release-fork.yml` using
GitHub-hosted runners. No upstream Blacksmith, Expo/EAS, Cloudflare or npm
publishing account is required.

## Artifacts

- Mac Apple Silicon and Intel: DMG and ZIP. Builds are unsigned/not notarized;
  macOS may require approval in Privacy & Security on first launch.
- Android: standalone signed APK, package `pro.ekotov.t3code`, labelled T3 Code EK.
  It installs alongside upstream. Pair the fork app with your existing server;
  upstream app data is not automatically transferred. Expo OTA updates are disabled.
- Linux x64: `t3-VERSION-linux-x64.tar.gz`, including the executable, native
  dependencies, resource monitor and web client; suitable for the GWDG workstation.
- `SHA256SUMS` for downloaded assets.

Use the existing SSH or private Tailscale endpoint in Add Environment. These builds
have no upstream cloud account/relay configuration. Manual release installation
is supported; desktop auto-update manifests are not published yet.

## Release

Push a tag such as `v0.0.45-ek.1`, or dispatch **Fork release** with version
`0.0.45-ek.1`. Manual runs upload Actions artifacts by default; select `publish`
to attach them to a prerelease in this repository. Manual publication requires
an existing version tag pointing at the selected build commit. Create/push the
tag with your own Git credentials; pushing it starts the release automatically.
This avoids relying on the Actions token to create a new release tag at a commit
that changes workflow files. Missing or mismatched tags fail before compilation.
Every platform must build
successfully before publication. Use a new version for every published release.

If publication fails after installers were collected, dispatch **Publish existing
fork installers** with the original run ID and version. It verifies the tag's
commit against the build, downloads `release-installers`, checks every SHA-256,
and publishes without recompiling. Publication verifies the existing tag rather
than asking the workflow token to create one with a target commit.

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
