# T3 Code EK

A customized fork of [T3 Code](https://github.com/pingdotgg/t3code) for cache control,
Slurm and workflows across multiple machines.

- **Cache controls:** Claude/Codex context HUDs, cache-expiry sorting and opt-in warming.
- **HPC workflows:** Slurm job status, machine grouping and conversation sorting.
- **Device utilities:** service health checks, custom actions, Android/Termux integration.
- **Everyday tools:** assistant citations, custom editors and recent custom snooze dates.

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
