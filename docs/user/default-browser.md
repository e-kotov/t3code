# Use T3 Code as your default browser

On macOS, the desktop app can be your default web browser. Links you open from other apps then
open in T3 Code. When the thread on screen shows its browser panel, the link opens there as a new
tab. Otherwise it starts a new thread without a project, with the browser panel maximized on the
page, so you can ask an agent about it right away.

Choose **T3 Code** under **System Settings → Desktop & Dock → Default web browser**. To go back,
choose another browser there.

Pull request links for a connected project open in the pull request view when opening pull
request links in the app is enabled. Other links still open in the browser panel.

HTML files you open from Finder open the same way. [Prompt links](prompt-links.md) to
app.t3.codes open in the app as a draft.

A link that launches T3 Code waits until the app has connected to its environment, then opens.

## Use a browser proxy

Select the environment in **Settings → Browser**, enter an HTTP, HTTPS or SOCKS5 proxy URL and turn on **Use browser
proxy**. Turn it off to keep the address saved while new tabs use their normal route. The setting is saved on that environment and is shared by its clients and scheduled agents.
Changes apply to new external tabs immediately; existing tabs keep their route.

Proxy tabs run in the environment's server browser and stream to the desktop or web client.
The proxy must be reachable from that environment host: `127.0.0.1` means that host, not the
viewing device. An existing SSH SOCKS forward can supply a URL such as
`socks5://127.0.0.1:1080`. T3 Code does not create or manage the tunnel. Proxy credentials and
PAC files are not supported. Local and private-network addresses, discovered development ports and app file previews stay direct
and keep their original browser host. An unsupported or older server returns an error instead of
opening a proxy request directly. Single-word hostnames, `.home.arpa` names and
IPv4-mapped IPv6 private addresses also stay direct. An explicit proxy request for a local or private
address is rejected; open it with `proxyUrl: ""` instead. In an existing proxy tab, attempting
to enter such an address shows an error and keeps the current page and history unchanged.

An agent can override the setting for one browser task with
`preview_open({url: "https://example.com", proxyUrl: "socks5://127.0.0.1:1080"})`, or force
direct access with `proxyUrl: ""`. An explicit override opens an independent tab by default;
use its returned `tabId` for later actions. To switch routes, open a new tab with the desired
`proxyUrl` and close the old tab. Reopening a closed tab preserves its route and browser host. `preview_status` reports the selected route. An unavailable
proxy fails the navigation instead of falling back to direct access.

Each proxy address has separate profile cookies and logins. Clearing a profile's data also
clears its proxy routes. Browser proxy settings do not change agent subprocess or T3 connection
traffic.
