# Install T3 Code EK

This is [Egor Kotov's fork](https://github.com/e-kotov/t3code) of
[T3 Code](https://github.com/pingdotgg/t3code). Use
[EK releases](https://github.com/e-kotov/t3code/releases), including prereleases,
to get the fork features. Upstream installers, app stores, `npx t3@latest`, and
the `t3-code` Homebrew cask install upstream T3 Code.

## Builds and testing limits

| Platform                             | Fork distribution                                           | Signing and verification limits                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon                  | DMG / ZIP, or Homebrew below                                | Signed with the fork's persistent private certificate; not Apple signed or notarized. CI verifies signatures and cross-build Keychain access, not the native GUI. |
| Android ARM64                        | Signed `-arm64.apk`                                         | Signed with the fork's persistent key, not upstream's key. CI covers build and native regression checks; device behavior needs manual verification.               |
| Linux x64                            | `t3-VERSION-linux-x64.tar.gz` server and bundled web client | SHA-256 checksums; no signed desktop package. Linux desktop GUI is neither built nor tested.                                                                      |
| Native Termux ARM64                  | `t3-VERSION-termux-arm64.tar.gz`                            | SHA-256 checksums; runtime setup compiles native dependencies on the phone. Packaging CI is not a device test.                                                    |
| iOS, Windows, Intel Mac, Linux ARM64 | No fork installers                                          | Not built or tested for distribution. Android x86 and 32-bit devices are also unsupported.                                                                        |

Automated tests and a successful build do not establish that every GUI or device workflow
works. These are experimental prereleases. Download `SHA256SUMS` alongside release assets
and verify them before installation; checksums are not a publisher signature.

## Mac

```sh
brew install --cask e-kotov/tap/t3-code-ek
```

Update with `brew update` followed by `brew upgrade --cask t3-code-ek`.
The cask verifies the DMG checksum and the app's pinned signing certificate, preserves
the release signature, and clears quarantine. This does not provide Apple notarization.
A manually downloaded app may need approval in macOS Privacy & Security.

When moving from an older ad-hoc-signed build, macOS may ask for the login Keychain
password once more. Choose **Always Allow** for `t3code Safe Storage`; subsequent
releases signed with the same certificate should retain that approval. Private signing
provides a stable app identity, not an Apple-verified publisher. Do not delete the Safe
Storage item: existing encrypted connection data depends on it.

## Android

Download the ARM64 APK from an EK release and allow installation from that source.
It installs as **T3 Code EK** alongside upstream. Existing upstream app data does
not transfer automatically. Keep using the fork APK for updates so the signing key matches.

### Share content into a conversation

From another Android app, share a supported image, document or text to T3 Code EK.
Choose the current conversation, search loaded conversations by title or project,
or start a new conversation. Content is added to the unsent draft alongside existing
text and attachments. File attachments require support from the connected server.

If you close the chooser, tap **Shared content waiting** to return. An unfinished
import blocks sending in its selected conversation until you retry, keep its saved
draft, or discard an unimported share. A share that has not merged can also be moved
to another conversation.

### Share the phone's T3 server

With the phone's Termux T3 runtime installed, sign in under **Settings → Built-in
Tailscale**, then enable **Share this phone on Tailscale**. Grant T3 Code EK the
Termux run-command permission if the server needs starting. The app keeps a foreground
notification with a **Stop** action while sharing is enabled.

Connect another device to the built-in node's Tailscale address on port `3774` and pair
with the phone's T3 server. Only that server is shared; Tailscale access rules and T3
pairing still apply. The phone does not need the Tailscale VPN app. Reopen T3 after a
reboot or force-stop to resume enabled sharing. Stopping sharing closes remote
connections without stopping the Termux server or its USB access.

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

## Existing Antigravity ACP installations

This fork uses upstream's ACP 1.4.1 runtime and model selection. Updating T3 Code
does not replace an already installed ACP runtime. ACP 1.4.2 through 1.4.4,
including the fork's previous 1.4.3 installation, write
`skills/system/run-workflow/SKILL.md` into session workspaces. The provider refuses
to start these known affected versions and shows an update instruction.

On each environment with one of these versions, open **Settings > Providers** on
web or desktop and choose **Update Antigravity**. Wait for installation to finish
and verify the provider reports 1.4.1 before refreshing models or starting a thread.
If **Binary path** is set, replace that executable and its matching
`localharness_external` helper with 1.4.1 yourself, or clear the override to use the
managed installation. See [manual installation](providers-antigravity.md#use-a-manual-installation).

The update keeps Google credentials and thread history. It does not remove files
that an earlier runtime already wrote into a workspace. Executables without recorded
version metadata cannot be checked against the affected-version list.

Release and maintainer details: [fork releases](../operations/fork-release.md).
