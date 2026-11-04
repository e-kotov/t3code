# Install T3 Code EK

This is [Egor Kotov's fork](https://github.com/e-kotov/t3code) of
[T3 Code](https://github.com/pingdotgg/t3code). Use
[EK releases](https://github.com/e-kotov/t3code/releases), including prereleases,
to get the fork features. Upstream installers, app stores, `npx t3@latest`, and
the `t3-code` Homebrew cask install upstream T3 Code.

## Builds and testing limits

| Platform                             | Fork distribution                                           | Signing and verification limits                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS Apple Silicon                  | DMG / ZIP, or Homebrew below                                | Signed with an Apple Development certificate for a personal team; not notarized. CI verifies signatures and cross-build Keychain access, not the native GUI. |
| Android ARM64                        | Signed `-arm64.apk`                                         | Signed with the fork's persistent key, not upstream's key. CI covers build and native regression checks; device behavior needs manual verification.          |
| Linux x64                            | `t3-VERSION-linux-x64.tar.gz` server and bundled web client | SHA-256 checksums; no signed desktop package. Linux desktop GUI is neither built nor tested.                                                                 |
| Native Termux ARM64                  | `t3-VERSION-termux-arm64.tar.gz`                            | SHA-256 checksums; runtime setup compiles native dependencies on the phone. Packaging CI is not a device test.                                               |
| iOS, Windows, Intel Mac, Linux ARM64 | No fork installers                                          | Not built or tested for distribution. Android x86 and 32-bit devices are also unsupported.                                                                   |

Automated tests and a successful build do not establish that every GUI or device workflow
works. These are experimental prereleases. Download `SHA256SUMS` alongside release assets
and verify them before installation; checksums are not a publisher signature.

## Mac

```sh
brew install --cask e-kotov/tap/t3-code-ek
```

Update with `brew update` followed by `brew upgrade --cask t3-code-ek`.
The cask verifies the DMG checksum and the app's Apple signing team and identifier, preserves
the release signature, and clears quarantine. This does not provide Apple notarization.
A manually downloaded app may need approval in macOS Privacy & Security.

When moving from an older build, macOS may ask for the login Keychain password once more.
Choose **Always Allow** for `t3code Safe Storage`; later builds signed with the same Apple
team and app identity are intended to retain that approval. This was tested with disposable
Keychain items, not every existing login Keychain. Do not delete the Safe Storage item:
existing encrypted connection data depends on it.

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

## Codex task quota consumption

On web and Mac, enable **Usage limits** under **Settings → Appearance → Thread details**.
Codex threads then show OpenAI's reported quota consumption for their current Codex task,
including its subagents. The percentages compare lifetime consumption with a current full
five-hour or weekly allowance; they can exceed 100% and are not limited to this week's work.
Readings refresh while the details are open. Missing readings are shown as **Not reported yet**,
and partial readings are marked with `~`.

This requires a ChatGPT-signed-in existing Codex installation with file-based credentials on
the thread's server. Managed ChatGPT connections and API-key providers are not supported by
this display. OpenAI may delay or withhold a reading even for a supported thread.

## Existing Antigravity ACP installations

This fork uses upstream's ACP 1.4.5 runtime and model selection. Updating T3 Code
does not replace an already installed ACP runtime. ACP 1.4.2 through 1.4.4,
including the fork's previous 1.4.3 installation, write
`skills/system/run-workflow/SKILL.md` into session workspaces. The provider refuses
to start these known affected versions and shows an update instruction.

On each environment with one of these versions, open **Settings > Providers** on
web or desktop and choose **Update Antigravity**. Wait for installation to finish
and verify the provider reports 1.4.5 before refreshing models or starting a thread.
If **Binary path** is set, replace that executable and its matching
`localharness_external` helper with 1.4.5 yourself, or clear the override to use the
managed installation. See [manual installation](providers-antigravity.md#use-a-manual-installation).

The update keeps Google credentials and thread history. It does not remove files
that an earlier runtime already wrote into a workspace. Executables without recorded
version metadata cannot be checked against the affected-version list.

Release and maintainer details: [fork releases](../operations/fork-release.md).

## Hand an existing BetterWright page to the human

On a server with an existing BetterWright sidecar, set
`T3CODE_BETTERWRIGHT_VIEW_COMMAND` to a JSON array naming its trusted viewer
launcher, for example `["/home/user/bin/sidecar-browser","view"]` for an
existing-only wrapper. Stock `betterwright view` can start a replacement browser
and does not meet this contract. Set `T3CODE_BETTERWRIGHT_RUN_COMMAND` to the same
wrapper's run command, such as `["/home/user/bin/sidecar-browser","run"]`; T3 uses
it to check which taps need the mobile keyboard.
A sidecar wrapper that fixes loopback itself can omit `--host`.
Both commands must attach to the existing daemon, fail if the sidecar is absent,
accept `--session`, optional `--profile`, and `--port 0`, and stop its own viewer
gracefully on SIGTERM. It must retain the browser and existing logins.

The agent calls `browser_handoff` with the existing BetterWright session and page
id, its profile when nondefault, and a short request for help. T3 shows the page
in its normal browser preview. Open it, select **Take control**, complete the
step, then **Release control**. The tool waits for that explicit release and then
the agent reinspects the same page. Closing the viewer or losing connectivity
does not count as completion. Handoffs time out after five minutes by default.

The viewer travels over the paired T3 server connection, including the mobile
app's embedded Tailscale route. No phone terminal command or global Android VPN
is required. Use the T3 connection for the host that owns the BetterWright page;
a phone-local server cannot attach to Raven's or GWDG's loopback viewer.
Only one handoff can run per server. The adapter supports page clicks, scrolling
and text entry; downloads, file uploads and native browser dialogs are outside
this handoff. Password-protected BetterWright live viewers are unsupported;
T3 itself authenticates viewer access. Other programs with direct BetterWright access must also leave the
page alone while the human operates it. Release does not establish that a site
accepted a CAPTCHA or granted access.

If the page does not arrive in T3's browser view, the desktop app offers **Open over SSH**.
It opens the host's own BetterWright viewer in a separate window through an SSH forward from
this Mac, using the SSH connection saved for that environment in Settings → Connections. The
desktop only takes the viewer lease from that environment's own saved address or its live T3 SSH
connection; environments reached only through T3 Connect get an explanation and the normal view.
The host key must already be in `known_hosts`; T3 never accepts new or changed host keys and
never forwards your SSH agent. While the window is open, T3's own viewers cannot take control.
The window talks only to a relay in the desktop app, never to BetterWright directly. Until
BetterWright reports the handoff page as the one it streams, the relay passes no picture and no
input; it drops other tabs, their previews, new and closed tabs, and non-web addresses.
BetterWright does not label pictures with their page, so a tab switch made by another viewer to a
tab with the same address and size, or input already on its way when another viewer switches,
can still briefly reach the other page. This guards the window on your Mac, not the daemon:
anyone with the same SSH login can reach the viewer directly. Finish, then select **Done,
release to agent** in T3; closing the window returns control without completing the handoff.
The fallback cannot help when SSH is unreachable or the browser or host has stopped. The web and
mobile apps keep only the normal view.

Adding the SSH connection for a server that already runs (for example one paired over
Tailscale) is not read-only. Saving it installs this app's T3 version under
`~/.t3/runtime/versions/` and a launcher under `~/.t3/ssh-launch/` on the host, creates a pairing
credential, and reuses the running server only when `~/.t3/userdata/server-runtime.json` on the
host the SSH alias reaches names a live process with a `http://127.0.0.1` or `localhost` origin
that answers within two seconds. Otherwise it starts a second server on the same `~/.t3` home.
Check those conditions on the host first, and make sure the alias reaches the same machine as the
running server rather than another login node.
