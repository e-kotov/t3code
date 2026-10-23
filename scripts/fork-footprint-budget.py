#!/usr/bin/env python3
"""Reject growth in fork edits to upstream-owned files; update only after review."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="record a reviewed baseline")
    parser.add_argument("--rev", default="HEAD")
    args = parser.parse_args()
    root = Path(git("rev-parse", "--show-toplevel"))
    os.chdir(root)
    baseline = root / "scripts/fork-footprint-budget.json"
    base = os.environ.get("UPSTREAM_SHA") or git("merge-base", args.rev, "refs/remotes/upstream/main")
    rows = git("diff", "--numstat", "--diff-filter=MD", "--no-renames", base, args.rev)
    counts = {}
    for row in rows.splitlines():
        added, removed, path = row.split("\t", 2)
        # The fork owns its landing page; fork-merge-upstream.sh preserves it.
        # Counting upstream README churn would otherwise block unrelated syncs.
        if path == "README.md":
            continue
        # A binary modification still consumes a slot and cannot disappear from the guard.
        counts[path] = int(added) + int(removed) if added != "-" else 1
    if args.write:
        baseline.write_text(json.dumps({"files": dict(sorted(counts.items()))}, indent=2) + "\n")
        print(f"Recorded {sum(counts.values())} changed lines in {len(counts)} upstream files")
        return 0
    budget = json.loads(baseline.read_text())["files"]
    failures = [f"{path}: {count} > {budget.get(path, 0)}" for path, count in sorted(counts.items())
                if count > budget.get(path, 0)]
    if failures:
        print("Fork edits grew in upstream-owned files:\n" + "\n".join(failures))
        print("Extract fork logic or review and explicitly update scripts/fork-footprint-budget.json.")
        return 1
    print(f"Fork footprint passed: {sum(counts.values())} changed lines in {len(counts)} upstream files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
