# Device utilities and commands

**Utilities** combines service health and your device commands. Its indicator is green
when every active service is healthy, orange for mixed results or warnings, red when
all active services are down, and gray when current health is unknown. Intentionally
inactive services are excluded. Open a service's **Details** for component checks,
observation age, available start/restart timestamps, output, and recovery actions.

Manage `~/.config/t3-utilities/dashboard.json` with your device's dotfiles. On desktop,
open **Settings → Utilities → Reload configuration**. On Android, use **Configure utilities →
Import / reload from Termux** after applying the file in Termux. Grant the Termux
permission described below and install Termux's `coreutils` package for execution deadlines.
An import copies the file into T3's private storage; later edits require another import.

Checks run locally while the app is active, including when the dashboard is closed.
Expired observations become unknown. Recovery actions run only when selected and
trigger a fresh check; command success alone does not establish service health.
Confirmations identify actions affecting shared services on other devices.
Desktop checks are coalesced across windows. Browsers, Windows and iOS have no local runner.

Configuration uses `version: 1` and a `services` array. Each service declares `id`,
`name`, affected `target`, shell `check`, and optional `actions` with their own `id`,
`name`, `command`, and `scope` (`device` or `shared`). Defaults are 60 seconds between
checks, expiry after 120 seconds, and a 30-second deadline. Set `intervalSeconds: 0`
for checks that should run only on opening or manual refresh. Set `enabled: false`
to exclude a service. Optional action confirmation defaults to enabled.

Check scripts write JSON with `version: 1` and a `services` array to stdout. The
matching service ID reports `status` (`healthy`, `warning`, `down`, `unknown`, or
`inactive`) and a short `summary`. Optional `startedAt` and `lastRestartedAt` are
RFC 3339 timestamps with a timezone, or null. A flat optional `checks` array reports
`id`, `name`, `status`, `summary`, and whether each component is `required`.
The script supplies overall service health; advisory components need not make it fail.
Diagnostics go to stderr. Exit zero means a valid observation, including `down`;
execution errors, invalid JSON or output exceeding 32 KiB mean unknown.
Keep interactive output unchanged by adding a JSON flag or using an adapter.

## Commands

Device commands run your own shell commands on the device where you press Run.
They work without a project or an online environment.

On macOS and Linux desktop, open **Settings → Utilities** to add a name, icon and shell
command. You can require confirmation and choose whether each command appears
in the command palette. Save and test a command, then use the **Utilities** menu
at the bottom of the sidebar to run it or inspect its output. Desktop commands
run in your login shell. Output streams into the dialog, where **Stop** ends
the local command and its subprocesses. Stopping the launcher does not undo a
remote job it already submitted.

On Android, open the **Utilities** tab beside Chats and Pull requests. Tap **Edit**
to add, reorder or delete commands. Install Termux, enable
`allow-external-apps = true` in `~/.termux/termux.properties`, and grant T3
permission to run Termux commands. **Test connection** checks that the setup
works without running one of your saved commands. Commands use Termux's Bash
login shell and existing tools and credentials. Their output arrives when
Termux finishes. Closing T3 does not cancel a Termux command; manage a running
command through Termux.

The command lists stay on each device and are not synced through connected
environments. Desktop stores its list in a separate `device-commands.json` file;
Settings shows its location. Android keeps its list in the app's private
storage. Device commands are unavailable in a plain web browser, on Windows, or on iOS.
