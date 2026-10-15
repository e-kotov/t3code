# Open projects in an editor

On web and desktop, open **Settings → Integrations → Editors** to choose a default
editor, show an editor that detection missed, or hide one you do not use.
**Automatic** follows availability; **Always show** offers the editor even when
it cannot be detected. Browsers cannot inspect installed apps, so remote opening
falls back to VS Code until you choose your own editors.

Choose **Remote links on this device** for editors that open remote projects over
SSH. A custom editor needs a URL template such as
`myeditor://ssh/{host}{path}`. Use `{pathQuery}` instead of `{path}` when placing
the path in a query parameter. `{line}` and `{column}` are optional. The editor
must be installed on the viewing device and support the chosen URL format.

Choose **Local commands on …** for projects opened locally on that environment.
A custom editor needs an executable and arguments, one per line. For example,
use `myeditor` with `--goto` and `{path}:{line}:{column}` on separate lines.
Arguments do not need shell quotes. If `{path}` is omitted, the path is appended.
Custom commands require a server version that supports them.

Preferences stay in this app or browser profile. Local commands are separate for
each environment; remote links apply on this viewing device. Edit, hide, or
remove custom entries in the same section, or use **Reset editors** to restore
automatic selection and remove custom entries. The native mobile app does not
have these editor controls.
