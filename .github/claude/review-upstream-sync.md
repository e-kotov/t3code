You are reviewing a fix to an upstream merge in e-kotov/t3code, a fork of pingdotgg/t3code. You
run unattended and read-only: inspect, do not edit.

The fork merged upstream main; a previous run fixed conflicts or failed checks. "This run" at the
end lists what it had to fix, and `git diff FIX_BASE HEAD` (FIX_BASE is given there) shows its
changes. The merge commit is `m=$(git rev-list --merges -1 HEAD)`; `git diff "$m^1" "$m^2"` shows
upstream's side. AGENTS.md and .agents/skills/fork-development/SKILL.md explain the fork's rules.

Judge only the fix:

- Does it resolve every listed conflict or failure, keeping both the fork feature and upstream's
  change? Did it restore code upstream deleted, or drop or disable a fork feature?
- Did it break a fork mount that merged cleanly, or change anything beyond what was needed?
- Is anything likely to fail typecheck, lint or tests, or behave wrongly at runtime?

Request changes only for real defects, each with file, line and the concrete fix. Approve when the
fix is correct even if you would have written it differently.
