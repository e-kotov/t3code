# Prompt cache warming

The **Warm all** button is visible in the main conversation interface. It turns
warming on or off for every conversation with a reported Claude cache
window, and each conversation button updates to match. You can then change any
conversation independently. Everything starts off. The global button applies to
the selected server. Individual buttons appear only while a supported
conversation's cache is hot. When some hot conversations are on and others off,
the global button shows **Warm all: Mixed**; clicking it turns warming on for all
currently hot conversations.

Warming sends a short, visible **billable** agent turn: it asks for exactly
`cache warm` and asks the agent to avoid tools and changes. It uses the current
conversation and model. It does not guarantee a provider cache hit or extend a
provider's cache lifetime beyond what that provider supports.

Codex warming is unavailable because Codex does not report a cache expiry.
Saved Codex warming selections do not trigger requests.

The server checks every 30 seconds. Claude conversations can warm within one
minute of reported cache expiry. Only a fresh
cache with observed cached or cache-creation tokens qualifies. Unsupported
providers, expired or unknown caches, subagents, archived conversations, active
work, pending approvals or background work, failures and usage-limit recovery
are skipped. An unchanged cache window is warmed at most once, including across
server restarts.

Settling or snoozing a conversation turns its warming off. Un-settling it or
waking it does not turn warming back on; use the conversation button again if
you want it. Settled and snoozed rows do not show the button.

Selections are saved on the server, so warming can run while clients are closed.
The server must remain running. Normal completion notifications may also report
these warming turns.
