# T3 Code EK

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/e-kotov/t3code/total?style=flat&logo=github&label=downloads)](https://github.com/e-kotov/t3code/releases)

A customized fork of [T3 Code](https://github.com/pingdotgg/t3code) for cache control,
Slurm and workflows across multiple machines.

<!-- fork-features:start -->

- **Cache and context:** [per-thread cache warming and idle compaction policies, shared across clients](docs/user/cache-warming.md); Claude/Codex context and cache HUDs with cache-expiry sorting; context usage and a compact action on mobile.
- **Usage and quotas:** provider quota readouts in the chat header with 5-hour and weekly bars, model-aware switching and a compact popup; official Codex task quota consumption on each thread.
- **Machines and HPC:** Slurm job status and time left in the header and filter menu; sidebar machine shelves with folding, machine filters, project grouping and open-thread counts; conversation sorting and grouping on web and mobile, reversed by selecting a sort again; the active machine and model in the thread header; machine names on thread links with subagent markers, and server label overrides.
- **Browser:** togglable browser proxy defaults and per-request routes; BetterWright pages handed to T3 clients, with an SSH viewer when the desktop stream fails.
- **Providers and automations:** Claude Artifacts for selected delegates; Antigravity over ACP with a custom client name, token and cache context, quotas and a browser preflight; agent-created scheduled tasks that start a new thread per run in the chosen destination.
- **Devices and Android:** [custom device commands in the command palette, on desktop and through Termux](docs/user/device-commands.md); service health checks and utility processes; the phone's server shared over the built-in tailnet and linked to Android; Android shares into a new or an existing conversation; direct agent notifications with opt-in subagent completion alerts; settle, snooze and retitle from an open thread on mobile.
- **Everyday tools:** assistant citations with quoting, in-place comments and passage reveal on Android; comments on source files, including files outside the project; [custom editors and open-in options](docs/user/editors.md); recent custom snooze dates in context and bulk menus; a new thread started with the selected conversation attached; paste as plain text, and Enter on an effort closes the model picker.
- **Releases:** [fork builds and updates for macOS, Android and Termux, with fork telemetry and update policies](docs/user/fork-install.md).

<!-- fork-features:end -->

## Install this fork

[Installation, updates and platform limits](docs/user/fork-install.md) ·
[Download EK releases](https://github.com/e-kotov/t3code/releases)

```sh
brew install --cask e-kotov/tap/t3-code-ek
```

Mac builds are **not Apple signed or notarized**. Android APKs are signed with the
fork's key. iOS, Windows, Intel Mac and Linux ARM64 installers are not supplied or
tested. Linux desktop GUI is not built or tested; Linux x64 server/web and native
Termux ARM64 archives are available. See the install guide for verification limits.

## Documentation and development

[User guides](docs/user) · [Fork release operations](docs/operations/fork-release.md) ·
[Fork development rules](.agents/skills/fork-development/SKILL.md) ·
[Source architecture](docs/internals/overview.md)

This fork is independent of upstream. For upstream's project description,
installation and community, see the [original README](https://github.com/pingdotgg/t3code/blob/main/README.md).
Upstream installers install upstream T3 Code and do not include these fork features.
