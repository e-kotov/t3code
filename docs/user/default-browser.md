# Use T3 Code as your default browser

On macOS, you can set the T3 Code desktop app as your default web browser so links from other apps and local HTML files open directly in T3 Code.

## Enable

Choose **T3 Code** in **System Settings → Desktop & Dock → Default web browser** (switch back there anytime).

## How links open

- If the active thread has its browser panel open, the link opens as a new tab there; otherwise T3 Code opens a new no-project thread with the browser panel maximized so you can ask an agent about the page right away.
- Pull request links for connected projects open in the PR view (when **Open pull requests in T3 Code** is enabled).
- [Prompt links](./prompt-links.md) to `app.t3.codes` open as a draft.

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
