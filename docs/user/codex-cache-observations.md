# Measure Codex cache reuse

No manual Codex cache setting is needed when signed in with ChatGPT. Resume the
same conversation normally. For a natural idle-gap observation, keep optional
[cache warming](cache-warming.md) off: warming sends requests that shorten the gap.

After a gap of at least 30 minutes between observed requests, `↩47m:82%` means
the first response after a 47-minute gap reported 82% of its input from cache.
A later tool response cannot replace this result. The latest such observation
remains visible across subsequent short-gap turns within the recent history
window. Web sidebar details include
exact counts and the observation timestamp; mobile includes them in the HUD's
accessibility description.

The 30-minute timer is a historical reference. Reaching zero changes Codex's
freshness state to unknown; it does not prove a cache miss. A partial cache hit
does not prove the whole old context was retained, and token reports do not
reveal how the provider stores or reconstructs cached state.

Install the updated server and clients to collect and display first-response
reports. Older turns cannot supply this measurement. A new provider thread or
model needs its own observations. Gaps cover only requests observed by this T3
provider thread; requests through another client are not visible here.
