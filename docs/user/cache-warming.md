# Prompt cache warming

The **Warm all** button is visible in the main conversation interface. It turns
warming on or off for every conversation with a current Codex or Claude cache
window, and each conversation button updates to match. You can then change any
conversation independently. Everything starts off. The global button applies to
the selected server.

Warming sends a short, visible **billable** agent turn: it asks for exactly
`cache warm` and asks the agent to avoid tools and changes. It uses the current
conversation and model. It does not guarantee a provider cache hit or extend a
provider's cache lifetime beyond what that provider supports.

The server checks every 30 seconds. Codex conversations can warm within five
minutes of cache expiry; Claude conversations within one minute. Only a fresh
cache with observed cached or cache-creation tokens qualifies. Unsupported
providers, expired or unknown caches, subagents, archived conversations, active
work, pending approvals or background work, failures and usage-limit recovery
are skipped. An unchanged cache window is warmed at most once, including across
server restarts.

Selections are saved on the server, so warming can run while clients are closed.
The server must remain running. Normal completion notifications may also report
these warming turns.
