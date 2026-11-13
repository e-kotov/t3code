# Connection renewal (fork)

A device paired with a pairing link, and an agent link to another environment, normally
stop working 30 days after pairing. In this fork they renew themselves while in use, so
they only lapse after 30 days without any connection.

**What renews.** Direct pairings from desktop, web and mobile, including pairings made over
SSH, and the links in **Settings → Labs → Linked environments**. T3 Connect, the browser
that serves the web app itself, startup links and outside MCP clients are unchanged.

**When.** A connected device asks its host about once every six hours, and the host extends
the session at most once a day to 30 days from then. A host keeps its own agent links
renewed in the background while it runs. Both ends need this fork version; with an older
host or client nothing changes and pairings expire as before.

**Limits.** A renewal never revives an expired or revoked pairing, so a device unused for 30
days must be paired again. Revoking a device in **Settings → Connections** ends every token
it holds at once. A pairing stops renewing one year after it was first made; pair it again
then. A device never renews over plain HTTP on a LAN or public address: use HTTPS, an SSH
connection, or a Tailscale address.

**Host settings** (environment variables of the T3 Code server):

| Variable                              | Default | Meaning                                                         |
| ------------------------------------- | ------- | --------------------------------------------------------------- |
| `T3CODE_SESSION_RENEWAL`              | `true`  | `false` turns renewal off; pairings expire after 30 days again. |
| `T3CODE_SESSION_RENEWAL_WINDOW_DAYS`  | `30`    | How long a pairing lasts after its last renewal.                |
| `T3CODE_SESSION_RENEWAL_MAX_AGE_DAYS` | `365`   | Cap from the first pairing; `0` removes the cap.                |

A managed policy that does not allow remote clients also stops renewal.
