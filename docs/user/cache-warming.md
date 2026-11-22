# Idle threads

In **Settings → Providers**, select a machine and set **While idle**:

- **Off** stops T3’s idle actions.
- **Keep warm** sends one short, visible request after a turn. It uses quota even
  if the cache misses. Antigravity warming applies to Gemini 4 Neon.
- **Compact** summarizes a large idle thread once. Antigravity needs a session
  that offers `/compact`.

Set the idle time for each provider on that machine. The defaults are 55 minutes
for Claude and Antigravity and 115 minutes for Codex. The timer starts when your
turn ends. T3 skips the action if it knows the cache has expired. The timer for
Codex and Antigravity is an estimate. A provider can evict the cache sooner.

In **Compact**, set each provider’s **Minimum context (k tokens)**. Enter
`200` for 200,000 tokens, the starting value. T3 checks both the idle time
and the current context. Manual compaction and provider context limits still apply.

T3 acts at most once after each user turn. It skips working, settled, and snoozed
threads. The server must be running during the idle window.

Choosing a mode replaces the machine’s previous idle rules and per-thread
warming choices. Until you choose a mode, the server continues to use its
previous rules. Update the client and server to configure the machine policy.
