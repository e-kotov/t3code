# Connection renewal (fork)

Direct pairing links can renew while in use. By default a pairing can lapse after
30 days of inactivity or one year after it was first made.

**What renews.** Direct pairings from desktop, web and mobile, including pairings made over
SSH. T3 Connect, the browser that serves the web app itself, startup links and outside MCP
clients are unchanged. The settings on this page apply only to these pairings.

**Linked environments.** The links in **Settings → Labs → Linked environments** renew
themselves while agents use them: each use keeps a link valid for 30 more days, with no
yearly cap and no setting to turn this off. A link unused for 30 days expires; link it
again with a new pairing code. Both machines need this version or later; see
[Link another environment](remote-access.md#link-another-environment).

**When.** A device paired with a proof-of-possession key refreshes its short access token
with that key and extends the pairing within the host's renewal limits. Existing bearer
pairings stay on the fork's renewal path: a connected device asks its host about once
every six hours, and the host extends the session at most once a day (with a shorter
window, in steps of a quarter of it). Newly paired clients use proof-of-possession
refresh when the host and client support it. Otherwise, they use the legacy bearer
path if both ends support it; they do not need to re-pair just to keep that path.

**Limits.** A renewal never revives an expired or revoked pairing, so a device unused for 30
days must be paired again. Revoking a device in **Settings → Connections** ends every token
it holds at once. A pairing stops renewing one year after it was first made; pair it again
then. Legacy bearer renewal does not send credentials over plain HTTP on a LAN or public
address: use HTTPS, an SSH connection, or a Tailscale address.

**Host settings** (environment variables of the T3 Code server):

| Variable                              | Default | Meaning                                                        |
| ------------------------------------- | ------- | -------------------------------------------------------------- |
| `T3CODE_SESSION_RENEWAL`              | `true`  | `false` stops extension; new pairings expire after 30 days.    |
| `T3CODE_SESSION_RENEWAL_WINDOW_DAYS`  | `30`    | How long a pairing lasts after its last renewal; at least `1`. |
| `T3CODE_SESSION_RENEWAL_MAX_AGE_DAYS` | `365`   | Cap from the first pairing; `0` removes the cap.               |

A value out of range (a window under one day, a negative cap, or more than 100 years) turns
renewal off and logs a warning. With extension off, a proof-of-possession device can
still refresh its short access token until the pairing's fixed expiration; it cannot
move that expiration. A managed policy that does not allow remote clients also stops
renewal.

**Migration.** Existing bearer pairings are not changed automatically.
To try key-bound refresh, use a separate device or browser profile with its own
T3 Code storage. Pair with one noncritical host via a standard one-time direct pairing
link, using a distinct label for the test device. Do not reuse your usual client or
another tab in the same browser profile: pairing with the same host there can replace
the saved connection. Keep the original client and link unchanged.

In the test browser profile, use the Network panel to confirm a successful
`POST /oauth/token` refresh after the initial pairing exchange. Request timing and
status are enough; do not inspect or share token values. Staying connected alone is
not proof: a legacy bearer pairing can also stay connected. Check that the test
connection works after its first short access token expires, then restart the test
client and check that it reconnects without pairing again.

If a check fails, remove only the test pairing from its client, revoke only that
device in **Settings → Connections**, and return to the existing link. Keep that
fallback while you expand one connection at a time.
