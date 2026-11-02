# Wants

Ideas I would like to keep track of, without a committed timeline.

## Idle-thread recap

- After a thread has been idle, show a brief, unobtrusive recap at the bottom of the conversation, with the current next step when there is one. Use the italic recap style seen in Codex and Claude Code CLIs.
- Keep this separate from compaction: it should help a returning user resume, without compacting or changing the conversation history.
- Use T3 Code's configured text-generation model selection and the selected provider's normal generation path. Treat it as ordinary model usage; do not assume a free recap endpoint.
- Send a bounded selection of recent, user-visible conversation text, not the complete thread. Codex's implementation uses up to eight recent exchanges, omits tool output and reasoning, and caps the recap prompt at an estimated 8,192 tokens.
- Choose the idle threshold, provider coverage, and user controls when this is picked up. No timeline is set.
