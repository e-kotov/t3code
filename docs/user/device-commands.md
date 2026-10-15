# Device commands

Device commands run your own shell commands on the device where you press Run.
They work without a project or an online environment.

In the desktop app, open **Settings → Commands** to add a name, icon and shell
command. You can require confirmation and choose whether each command appears
in the command palette. Save and test a command, then use the **Commands** menu
at the bottom of the sidebar to run it or inspect its output. Desktop commands
run in your login shell. Output streams into the dialog, where **Stop** ends
the local command and its subprocesses. Stopping the launcher does not undo a
remote job it already submitted.

On Android, open the **Commands** tab beside Chats and Pull requests. Tap **Edit**
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
storage. Device commands are unavailable in a plain web browser or on iOS.
