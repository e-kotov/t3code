# Install T3 Code EK

This is [Egor Kotov's fork](https://github.com/e-kotov/t3code) of
[T3 Code](https://github.com/pingdotgg/t3code). Use
[EK releases](https://github.com/e-kotov/t3code/releases), including prereleases,
to get the fork features. Upstream installers, app stores, `npx t3@latest`, and
the `t3-code` Homebrew cask install upstream T3 Code.

## Builds and testing limits

| Platform | Fork distribution | Signing and verification limits |
| --- | --- | --- |
| macOS Apple Silicon | DMG / ZIP, or Homebrew below | Not Apple signed or notarized. Homebrew applies an ad hoc signature. CI builds do not verify the native GUI. |
| Android ARM64 | Signed `-arm64.apk` | Signed with the fork's persistent key, not upstream's key. CI covers build and native regression checks; device behavior needs manual verification. |
| Linux x64 | `t3-VERSION-linux-x64.tar.gz` server and bundled web client | SHA-256 checksums; no signed desktop package. Linux desktop GUI is neither built nor tested. |
| Native Termux ARM64 | `t3-VERSION-termux-arm64.tar.gz` | SHA-256 checksums; runtime setup compiles native dependencies on the phone. Packaging CI is not a device test. |
| iOS, Windows, Intel Mac, Linux ARM64 | No fork installers | Not built or tested for distribution. Android x86 and 32-bit devices are also unsupported. |

Automated tests and a successful build do not establish that every GUI or device workflow
works. These are experimental prereleases. Download `SHA256SUMS` alongside release assets
and verify them before installation; checksums are not a publisher signature.

## Mac

```sh
brew install --cask e-kotov/tap/t3-code-ek
```

Update with `brew update` followed by `brew upgrade --cask t3-code-ek`.
The cask verifies the DMG checksum, re-signs the app ad hoc and clears quarantine;
this does not provide Apple notarization. A manually downloaded app may need
approval in macOS Privacy & Security.

## Android

Download the ARM64 APK from an EK release and allow installation from that source.
It installs as **T3 Code EK** alongside upstream. Existing upstream app data does
not transfer automatically. Keep using the fork APK for updates so the signing key matches.

## Linux server

Download the Linux x64 archive and `SHA256SUMS` from the same EK release.
Run `sha256sum --ignore-missing --check SHA256SUMS` in the download directory,
extract the archive, and run its `t3` executable. Authenticate at least one
[provider](install.md#providers) on the server before starting agent work.
Use `t3 --help` for commands. `t3 update` follows EK releases; `t3 service install`
sets up a background service when supported by the host.

In the desktop app, adding an **SSH environment** provisions the Linux x64 server
from the EK release matching the desktop version, verifies its checksum, and launches
it through SSH. The remote needs SSH access, curl or wget, and tar. This is a
per-user runtime, not a Slurm job submission or a system-wide service installation.
The desktop version must have a published matching server asset. Other remote
platforms currently lack the standalone archives this installer expects.

For an already running server, pair through its existing private endpoint instead.
The release builds have no upstream cloud-account/relay configuration.

## Termux

The Termux archive requires a native Termux runtime and native dependency setup;
it is not the generic Linux ARM64 binary. Egor's managed phone uses
`t3-termux update` from the Termux dotfiles. Other installations need equivalent
runtime setup; a general-purpose Termux bootstrap installer is not supplied here.

Release and maintainer details: [fork releases](../operations/fork-release.md).
