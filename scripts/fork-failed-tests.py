#!/usr/bin/env python3
"""Lists the test files to rerun alone after `check:changed` failed only in its test step.

A large upstream merge runs hundreds of test files at once on a small runner, and slow browser
tests then time out. Exit 0 and print `<package dir> <test file>` per failed file when the test
step is the only failed step and every failed file is found; exit 1 otherwise, so the caller
keeps the original failure.

usage: fork-failed-tests.py CHECK_CHANGED_LOG [REPO_ROOT]
"""
from pathlib import Path
import re
import sys

ANSI = re.compile(r"(?:\x1b\[|\^\[\[)[0-9;]*m")
STEP = re.compile(r"^\s+(pass|FAIL|TIMEOUT)\s+(.+?)\s+(?:[\d.]+s|killed after \d+s)$")
FAILED_FILE = re.compile(r"\bFAIL\s+.*?(\S+\.test\.tsx?)(?:\s|>|$)")
ROOTS = ("apps", "packages", "scripts")


def failed_tests(text, repo):
    lines = [ANSI.sub("", line) for line in text.splitlines()]
    start = max((i for i, line in enumerate(lines) if "check:changed summary" in line), default=None)
    if start is None:
        raise SystemExit("no check:changed summary in the log")
    bad = []
    for line in lines[start + 1 :]:
        match = STEP.match(line)
        if match is None:
            if line.strip().startswith("CI also runs"):
                break
            continue
        if match.group(1) != "pass":
            bad.append((match.group(1), match.group(2)))
    if not bad:
        raise SystemExit("check:changed reported no failed step")
    other = [name for kind, name in bad if kind != "FAIL" or not name.startswith("test (")]
    if other:
        raise SystemExit("not only the test step failed: " + ", ".join(other))
    files = sorted({m.group(1) for line in lines if (m := FAILED_FILE.search(line))})
    if not files:
        raise SystemExit("the test step failed but no failed test file was found")
    packages = sorted(
        str(path.parent.relative_to(repo))
        for root in ROOTS
        for path in (repo / root).glob("*/package.json")
    ) + ["scripts"]
    result = []
    for file in files:
        owners = [p for p in packages if (repo / p / file).is_file()]
        if not owners and (repo / file).is_file():
            parts = Path(file).parts
            owners = [str(Path(*parts[:2]))] if parts[0] in ("apps", "packages") else [parts[0]]
            file = str(Path(*Path(file).parts[len(Path(owners[0]).parts):]))
        if len(owners) != 1:
            raise SystemExit(f"cannot place {file} in one package ({owners})")
        result.append(f"{owners[0]} {file}")
    return result


if __name__ == "__main__":
    log = Path(sys.argv[1]).read_text(errors="replace")
    repo = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.cwd()
    print("\n".join(failed_tests(log, repo)))
