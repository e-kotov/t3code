#!/usr/bin/env bash
# Runs the ordered Claude/Pi resolvers for .github/workflows/claude-sync.yml.
#   fix BUDGET        fix the failed merge described in $RUNNER_TEMP/context.md; commit the result
#   review BUDGET     review that fix read-only; outputs verdict=approve|changes|skipped
#   follow-up BUDGET  address review findings, or a failed check, in one more commit
# BUDGET caps Claude Platform spend in US dollars. Pi is bounded by its Vercel API-key budget.
set -euo pipefail

mode=${1:?usage: claude-sync.sh fix|review|follow-up BUDGET}
budget=${2:?budget in USD required}
model=${CLAUDE_MODEL:?}
pi_model=${PI_MODEL:-meta/muse-spark-1.3-contributor}
pi_thinking=${PI_THINKING:-xhigh}
resolver_order=${UPSTREAM_RESOLVER_ORDER:-claude,pi}
selected_resolver=
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
    sys.exit(1)
cost = data.get("total_cost_usd")
print(f"\n### Claude {sys.argv[2]} ({data.get('subtype', '?')}, ${cost:.2f})\n" if cost is not None else f"\n### Claude {sys.argv[2]}\n")
print(str(data.get("result", ""))[:3000])
sys.exit(0 if data.get("subtype") == "success" else 1)
PY
  local result_status=$?
  if [ "$status" -ne 0 ] || [ "$result_status" -ne 0 ]; then return 1; fi
}

run_pi() {
  local result=$1 tools=$2
  if [ -z "${AI_GATEWAY_API_KEY:-}" ]; then
    summary "Pi fallback is unavailable: set the VERCEL_AI_GATEWAY_API_KEY repository secret."
    return 1
  fi
  local status=0
  local raw_events="$RUNNER_TEMP/pi-events.jsonl"
  pi --print --mode json --no-session --no-extensions --no-mcp --no-skills --no-prompt-templates \
    --no-approve --provider vercel-ai-gateway --model "$pi_model" --thinking "$pi_thinking" \
    --tools "$tools" "$(cat "$RUNNER_TEMP/prompt.md")" > "$raw_events" || status=$?
  if [ "$status" -eq 0 ] && [ ! -s "$raw_events" ]; then status=1; fi
  python3 - "$raw_events" "$result" "$mode" "$pi_model" "$pi_thinking" >> "${GITHUB_STEP_SUMMARY:-/dev/stderr}" <<'PY'
import json, pathlib, sys
events_file, result_file, mode, model, thinking = sys.argv[1:6]
text_chunks = []
total_input_tokens = 0
total_output_tokens = 0
total_cache_read = 0
total_cost = 0.0

# Vercel AI Gateway rates for meta/muse-spark-1.3-contributor (per token)
input_rate = 0.0000001
output_rate = 0.0000002
cache_read_rate = 0.000000002

try:
    for line in pathlib.Path(events_file).read_text().splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except Exception:
            continue
        ev_type = event.get("type")
        if ev_type == "message_end":
            msg = event.get("message", {})
            if msg.get("role") == "assistant":
                usage = msg.get("usage", {})
                inp = usage.get("input", 0)
                outp = usage.get("output", 0)
                cread = usage.get("cacheRead", 0)
                total_input_tokens += inp
                total_output_tokens += outp
                total_cache_read += cread
                reported_cost = usage.get("cost", {}).get("total")
                if reported_cost is not None and reported_cost > 0:
                    total_cost += reported_cost
                else:
                    total_cost += (inp * input_rate) + (outp * output_rate) + (cread * cache_read_rate)
                for part in msg.get("content", []):
                    if part.get("type") == "text":
                        text_chunks.append(part.get("text", ""))
        elif ev_type == "text" or ev_type == "response":
            if "text" in event:
                text_chunks.append(event["text"])
except Exception as e:
    pass

full_text = "\n".join(text_chunks).strip()
try:
    pathlib.Path(result_file).write_text(full_text)
except Exception:
    pass

cost_label = f", ${total_cost:.3f}" if total_cost > 0 or total_input_tokens > 0 else ""
print(f"\n### Pi {mode} ({model}, {thinking}{cost_label})\n")
print(full_text[:3000] if full_text else "No result")
PY
  return "$status"
}

review_is_valid() {
  local resolver=$1 result=$2
  python3 - "$resolver" "$result" <<'PY'
import json, pathlib, sys
resolver, filename = sys.argv[1:]
try:
    text = pathlib.Path(filename).read_text()
    if resolver == "claude":
        response = json.loads(text)
        verdict = response.get("structured_output")
        if verdict is None:
            verdict = json.loads(response.get("result", ""))
    else:
        decoder = json.JSONDecoder()
        verdict = None
        for index, char in enumerate(text):
            if char == "{":
                try:
                    candidate, _ = decoder.raw_decode(text[index:])
                except json.JSONDecodeError:
                    continue
                verdict = candidate
                break
    valid = (
        isinstance(verdict, dict)
        and verdict.get("verdict") in {"approve", "changes"}
        and isinstance(verdict.get("findings"), list)
        and all(isinstance(item, str) for item in verdict["findings"])
        and isinstance(verdict.get("summary"), str)
    )
except (OSError, ValueError, TypeError):
    valid = False
sys.exit(0 if valid else 1)
PY
}

save_review() {
  local resolver=$1 result=$2
  python3 - "$resolver" "$result" "$RUNNER_TEMP/findings.md" "${GITHUB_OUTPUT:-/dev/null}" <<'PY'
import json, pathlib, sys
resolver, filename, findings_path, output_path = sys.argv[1:]
text = pathlib.Path(filename).read_text()
if resolver == "claude":
    response = json.loads(text)
    verdict = response.get("structured_output")
    if verdict is None:
        verdict = json.loads(response["result"])
else:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char == "{":
            try:
                verdict, _ = decoder.raw_decode(text[index:])
                break
            except json.JSONDecodeError:
                continue
    else:
        raise ValueError("Pi review did not return a JSON object")
with open(findings_path, "w") as findings:
    findings.write("\n".join(f"- {item}" for item in verdict["findings"]) + "\n")
with open(output_path, "a") as output:
    output.write(f"verdict={verdict['verdict']}\n")
PY
}

run_resolver() {
  local tools=$1 allowed=$2 result=$3; shift 3
  local resolver status=1
  local -a resolvers
  IFS=, read -r -a resolvers <<< "$resolver_order"
  if [ "${#resolvers[@]}" -ne 2 ] ||
    { [ "${resolvers[0]}" != claude ] && [ "${resolvers[0]}" != pi ]; } ||
    { [ "${resolvers[1]}" != claude ] && [ "${resolvers[1]}" != pi ]; } ||
    [ "${resolvers[0]}" = "${resolvers[1]}" ]; then
    echo "UPSTREAM_RESOLVER_ORDER must be claude,pi or pi,claude (got '$resolver_order')." >&2
    return 2
  fi
  summary "Resolver priority: ${resolvers[*]} (mode: $mode)."
  for resolver in "${resolvers[@]}"; do
    status=0
    summary "Trying $resolver for $mode."
    if [ "$resolver" = claude ]; then
      run_claude "$tools" "$allowed" "$result" "$@" || status=$?
    else
      local pi_prompt="$RUNNER_TEMP/prompt.md"
      if [ "$mode" = review ]; then
        pi_prompt="$RUNNER_TEMP/pi-review-prompt.md"
        cat "$RUNNER_TEMP/prompt.md" > "$pi_prompt"
        cat >> "$pi_prompt" <<'PROMPT'

Return exactly one JSON object and no Markdown fences, with this shape:
{"verdict":"approve","findings":[],"summary":"No defects found."}
Set `verdict` to `changes` and list concrete defects in `findings` when changes are needed.
PROMPT
        cp "$pi_prompt" "$RUNNER_TEMP/prompt.md"
      fi
      run_pi "$result" "$tools" || status=$?
    fi
    if [ "$status" -eq 0 ]; then
      if [ "$mode" = review ] && ! review_is_valid "$resolver" "$result"; then
        summary "$resolver review response was not a valid structured verdict; trying the next resolver."
        status=1
        continue
      fi
      out "agent=$resolver"
      selected_resolver=$resolver
      summary "Resolved $mode with $resolver."
      if [ "$mode" = review ]; then save_review "$resolver" "$result"; fi
      return 0
    fi
    summary "$resolver did not complete $mode (exit $status); trying the next resolver."
    if [ "$resolver" != "${resolvers[1]}" ]; then
      cat >> "$RUNNER_TEMP/prompt.md" <<PROMPT

## Previous resolver attempt

$resolver did not complete this stage. Its partial file changes may be present. Inspect the
current worktree and continue from it; preserve useful changes and repair or replace bad ones.
PROMPT
    fi
  done
  summary "No configured resolver completed $mode."
  return 1
}

commit() {
  git add -A
  if git diff --cached --quiet; then
    summary "Resolver $selected_resolver $mode changed no files."
  else
    git commit -q -m "fix(sync): $selected_resolver $mode"
  fi
}

case "$mode" in
  fix)
    cat .github/claude/fix-upstream-sync.md "$RUNNER_TEMP/context.md" > "$RUNNER_TEMP/prompt.md"
    run_resolver 'read,edit,write,grep,find,ls,bash' "$fix_tools" "$RUNNER_TEMP/fix-result" || exit 1
    commit
    ;;
  review)
    {
      cat .github/claude/review-upstream-sync.md "$RUNNER_TEMP/context.md"
      echo
      echo "FIX_BASE: $(cat "$RUNNER_TEMP/fix-base")"
    } > "$RUNNER_TEMP/prompt.md"
    if ! run_resolver 'read,grep,find,ls' "$review_tools" "$RUNNER_TEMP/review-result" \
      --json-schema "$verdict_schema"; then
      summary "No resolver completed the review; the checks decide alone."
      out "verdict=skipped"
      exit 0
    fi
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
    run_resolver 'read,edit,write,grep,find,ls,bash' "$fix_tools" "$RUNNER_TEMP/follow-up-result" || exit 1
    commit
    ;;
  *)
    echo "unknown mode $mode" >&2
    exit 1
    ;;
esac
