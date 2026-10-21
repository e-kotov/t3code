# Measure Codex cache reuse

No manual Codex cache setting is needed when signed in with ChatGPT. Resume the
same conversation normally. T3 does not send automatic Codex cache-warming
requests.

After a gap of at least 30 minutes between observed requests, `↩47m:82%` means
the first response after a 47-minute gap reported 82% of its input from cache.
A later tool response cannot replace this result. The latest such observation
remains visible across subsequent short-gap turns within the recent history
window. Web sidebar details include
exact counts and the observation timestamp; mobile includes them in the HUD's
accessibility description.

Codex shows the last observed request result, such as `Last hit 99%` or
`Last miss 0%`. There is no Codex expiry countdown or warning: its retention
lifetime is not reported, and elapsed time cannot determine the next hit.
Conversation details include the last report's timestamp. A partial cache hit
does not prove the whole old context was retained, and token reports do not
reveal how the provider stores or reconstructs cached state.

Install the updated server and clients to collect and display first-response
reports. Older turns cannot supply this measurement. A new provider thread or
model needs its own observations. Gaps cover only requests observed by this T3
provider thread; requests through another client are not visible here.
