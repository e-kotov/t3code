#!/usr/bin/env bash
# Runs Claude Code for .github/workflows/claude-sync.yml.
#   fix BUDGET        fix the failed merge described in $RUNNER_TEMP/context.md; commit the result
#   review BUDGET     review that fix read-only; outputs verdict=approve|changes|skipped
#   follow-up BUDGET  address review findings, or a failed check, in one more commit
# BUDGET caps estimated spend in US dollars for the run (--max-budget-usd).
set -euo pipefail

mode=${1:?usage: claude-sync.sh fix|review|follow-up BUDGET}
budget=${2:?budget in USD required}
model=${CLAUDE_MODEL:?}
summary() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}"; }
out() { echo "$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# Fixers edit files and run the checks of what they touch; nothing reaches the network or git remotes.
fix_tools='Read,Edit,Write,Glob,Grep,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git status:*),Bash(git rev-list:*),Bash(git grep:*),Bash(cd:*),Bash(vp:*),Bash(python3 scripts/fork-footprint-budget.py:*)'
review_tools='Read,Glob,Grep,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git rev-list:*),Bash(git grep:*)'
verdict_schema='{"type":"object","properties":{"verdict":{"type":"string","enum":["approve","changes"]},"findings":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["verdict","findings","summary"]}'

run_claude() {
  local tools=$1 allowed=$2 result=$3
  shift 3
  local status=0
  claude -p "$(cat "$RUNNER_TEMP/prompt.md")" --model "$model" --effort high \
    --permission-mode dontAsk --tools "$tools" --allowedTools "$allowed" \
    --disallowedTools 'WebFetch,WebSearch' --max-budget-usd "$budget" \
    --output-format json --no-session-persistence "$@" > "$result" || status=$?
  python3 - "$result" "$mode" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    print(f"\n### Claude {sys.argv[2]}: no result\n")
    sys.exit(0)
cost = data.get("total_cost_usd")
print(f"\n### Claude {sys.argv[2]} ({data.get('subtype', '?')}, ${cost:.2f})\n" if cost is not None else f"\n### Claude {sys.argv[2]}\n")
print(str(data.get("result", ""))[:3000])
PY
  return "$status"
}

commit() {
  git add -A
  if git diff --cached --quiet; then
    summary "Claude $mode changed no files."
  else
    git commit -q -m "fix(sync): Claude $mode"
  fi
}

case "$mode" in
  fix)
    cat .github/claude/fix-upstream-sync.md "$RUNNER_TEMP/context.md" > "$RUNNER_TEMP/prompt.md"
    run_claude 'Read,Edit,Write,Glob,Grep,Bash' "$fix_tools" "$RUNNER_TEMP/claude-fix.json" ||
      summary "Claude fix ended early; committing what it changed."
    commit
    ;;
  review)
    {
      cat .github/claude/review-upstream-sync.md "$RUNNER_TEMP/context.md"
      echo
      echo "FIX_BASE: $(cat "$RUNNER_TEMP/fix-base")"
    } > "$RUNNER_TEMP/prompt.md"
    if ! run_claude 'Read,Glob,Grep,Bash' "$review_tools" "$RUNNER_TEMP/claude-review.json" \
      --json-schema "$verdict_schema"; then
      summary "The review did not finish; the checks decide alone."
      out "verdict=skipped"
      exit 0
    fi
    python3 - "$RUNNER_TEMP/claude-review.json" "$RUNNER_TEMP/findings.md" "${GITHUB_OUTPUT:-/dev/null}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
verdict = data.get("structured_output")
if verdict is None:
    try:
        verdict = json.loads(data.get("result", ""))
    except ValueError:
        verdict = {"verdict": "skipped", "findings": []}
with open(sys.argv[2], "w") as findings:
    findings.write("\n".join(f"- {item}" for item in verdict.get("findings", [])) + "\n")
with open(sys.argv[3], "a") as output:
    output.write(f"verdict={verdict.get('verdict', 'skipped')}\n")
PY
    ;;
  follow-up)
    {
      cat .github/claude/fix-upstream-sync.md
      echo
      echo "## This run"
      echo
      echo "HEAD already contains a previous fix. Fix only what follows; keep the previous fix otherwise."
      echo
      if [ -s "$RUNNER_TEMP/findings.md" ]; then
        echo "A reviewer requested these changes to the previous fix (see \`git diff $(cat "$RUNNER_TEMP/fix-base") HEAD\`):"
        echo
        cat "$RUNNER_TEMP/findings.md"
      else
        sed '1,/^## This run/d' "$RUNNER_TEMP/context.md"
      fi
    } > "$RUNNER_TEMP/prompt.md"
    run_claude 'Read,Edit,Write,Glob,Grep,Bash' "$fix_tools" "$RUNNER_TEMP/claude-follow-up.json" ||
      summary "Claude follow-up ended early; committing what it changed."
    commit
    ;;
  *)
    echo "unknown mode $mode" >&2
    exit 1
    ;;
esac
