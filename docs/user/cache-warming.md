# Idle cache policies and warming

Choose an idle cache policy from a conversation’s cache control or context menu.
On mobile, tap the memory-chip icon; no hover is needed. Choices are saved on the
connected server and shared across devices.
Update both the client and connected server to a build with per-thread cache policies.

- **Default** follows the Claude instance’s settings, including its override of
  **Settings → General → Compact idle threads**. It sends no warming turns.
- **Keep warm** sends visible, billable warm turns near expiry and suppresses
  automatic idle compaction and return-compaction prompts.
- **Compact before expiry** uses Claude’s automatic compaction for idle
  conversations with at least 200k context tokens and a known cache expiry, even
  if the machine’s default is Never.
- **Off** disables warming, automatic idle compaction and return prompts for this
  conversation.

New conversations use Default. Existing warming opt-ins carry over as Keep warm.
Codex supports Default, Keep warm and Off; Claude’s idle compaction is not offered
for Codex. Manual compaction and compaction at the provider’s context limit remain
available under every policy.

The machine-wide **Warm all** switch updates currently hot Codex/Claude
conversations to Keep warm or back to Default. Each conversation can then be
changed independently. Mixed means some eligible conversations have Keep warm
selected and others do not. Default can still use automatic compaction.

Warming sends a short, visible **billable** agent turn: it asks for exactly
`cache warm` and asks the agent to avoid tools and changes. It uses the current
conversation and model. It does not guarantee a provider cache hit or extend a
provider’s cache lifetime beyond what that provider supports.

The server checks every 30 seconds. Codex uses an assumed one-hour cache window
and can warm within its final five minutes; Claude conversations within one minute
of their reported expiry. The Codex estimate does not guarantee retention. Only a
new usage report can confirm reuse; once the estimate passes, Codex shows unknown
cache status and keeps the last-request counters visible. Only a
fresh cache with observed cached or cache-creation tokens qualifies. Unsupported
providers, expired or unknown caches, subagents, archived conversations, active
work, pending approvals or background work, failures and usage-limit recovery
are skipped. An unchanged cache window is warmed at most once, including across
server restarts.

Settling or snoozing resets Keep warm to Default. Waking or un-settling does not
silently enable warming again. Neither background action runs on a
conversation you have explicitly settled or snoozed until later. Changing policy also rechecks waiting compaction
timers and queued warming actions before they can send a turn.

The server must remain running for background actions to work, even while clients
are closed. Normal completion notifications may also report warming turns.
