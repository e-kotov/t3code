#!/usr/bin/env python3
"""Find, and with --delete remove, provably dead GitHub Actions caches.

Only two classes are ever selected: keys starting with `setup-go-` (the fork's tailnet
build caches its library instead) and caches on `refs/pull/<n>/merge` whose PR is closed.
Every lookup finishes before the first deletion, so any API failure deletes nothing.
"""
import argparse
import json
import os
import re
import subprocess
import sys

PR_MERGE_REF = re.compile(r"refs/pull/([0-9]+)/merge")


def gh_json_lines(*args):
    out = subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def list_caches(repo):
    total = gh_json_lines(f"repos/{repo}/actions/caches?per_page=1", "--jq", ".total_count")[0]
    caches = gh_json_lines("--paginate", f"repos/{repo}/actions/caches?per_page=100",
                           "--jq", ".actions_caches[]")
    if len(caches) != total:
        raise RuntimeError(f"listed {len(caches)} caches but the API reports {total}")
    return caches


def pr_state(repo, number):
    return gh_json_lines(f"repos/{repo}/pulls/{number}", "--jq", "{state: .state}")[0]["state"]


def select_obsolete(caches, pr_states):
    """Return (cache, reason) pairs; pr_states maps PR number strings to 'open' or 'closed'."""
    selected = []
    for cache in caches:
        key, ref = cache.get("key", ""), cache.get("ref", "")
        if key.startswith("setup-go-"):
            selected.append((cache, "setup-go"))
            continue
        match = PR_MERGE_REF.fullmatch(ref)
        if match and pr_states[match.group(1)] == "closed":
            selected.append((cache, f"closed PR #{match.group(1)}"))
    return selected


def mib(size):
    return f"{size / 2**20:.1f} MiB"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "e-kotov/t3code"))
    parser.add_argument("--delete", action="store_true", help="delete candidates (default: dry run)")
    args = parser.parse_args(argv)
    mode = "delete" if args.delete else "dry-run"

    try:
        caches = list_caches(args.repo)
        numbers = {m.group(1) for c in caches if (m := PR_MERGE_REF.fullmatch(c.get("ref", "")))}
        pr_states = {n: pr_state(args.repo, n) for n in sorted(numbers, key=int)}
    except (subprocess.CalledProcessError, ValueError, KeyError, IndexError, RuntimeError) as error:
        detail = getattr(error, "stderr", "") or error
        print(f"::error::Cache lookup failed; nothing deleted: {str(detail).strip()}")
        return 1

    selected = select_obsolete(caches, pr_states)
    total = sum(c.get("size_in_bytes", 0) for c in caches)
    candidate_total = sum(c.get("size_in_bytes", 0) for c, _ in selected)
    lines = [
        f"Cache inventory: {len(caches)} entries ({mib(total)}); "
        f"obsolete ({mode}): {len(selected)} ({mib(candidate_total)})",
    ]
    lines += [f"- PR #{n}: {state}" for n, state in pr_states.items()]
    status = 0
    deleted = 0
    for cache, reason in selected:
        label = f"{cache['id']} {mib(cache.get('size_in_bytes', 0))} {reason} {cache['ref']} {cache['key'][:80]}"
        if not args.delete:
            lines.append(f"- would delete {label}")
            continue
        result = subprocess.run(["gh", "api", "-X", "DELETE",
                                 f"repos/{args.repo}/actions/caches/{cache['id']}"],
                                capture_output=True, text=True)
        if result.returncode != 0:
            lines.append(f"- FAILED {label}: {result.stderr.strip()}")
            status = 1
            break
        deleted += 1
        lines.append(f"- deleted {label}")
    if args.delete:
        lines.append(f"Deleted {deleted} of {len(selected)}")

    print("\n".join(lines))
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"### Obsolete Actions caches ({mode})\n\n" + "\n".join(lines) + "\n")
    return status


if __name__ == "__main__":
    sys.exit(main())
