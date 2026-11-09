#!/usr/bin/env python3
"""Keep fork features from disappearing in upstream syncs.

  check [--before REV] [--rev REV]
      Validate scripts/fork-features.json: every feature names existing tests and every
      fork-owned test belongs to a feature. Require README's feature list to match it. With
      --before (the fork main a sync started from), every file the fork owned there must still
      exist in --rev.
  approval --before REV [--rev REV]
      Print why an automated resolution needs Egor's approval before it reaches main: it changed
      fork-owned tests or guard files, or it shrank fork mounts in upstream files. Empty if none.
  readme [--write]
      Print, or write into README.md, the feature list generated from the manifest.

A file is fork-owned when the fork added it relative to the upstream commit it contains.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MANIFEST = "scripts/fork-features.json"
README = "README.md"
START, END = "<!-- fork-features:start -->", "<!-- fork-features:end -->"
TEST = re.compile(r"\.test\.(?:ts|tsx|py)$")
GUARD_FILES = (MANIFEST, "scripts/fork-footprint-budget.json")


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


# rev None means the working tree, so a resolver can check its uncommitted result.
def upstream_base(rev):
    return git("merge-base", rev or "HEAD", "refs/remotes/upstream/main")


def fork_owned(rev):
    base = upstream_base(rev)
    rows = git("diff", "--name-only", "--diff-filter=A", "--no-renames", base, *([rev] if rev else []))
    owned = set(rows.splitlines())
    if rev is None:
        owned.update(git("ls-files", "--others", "--exclude-standard").splitlines())
    return owned


def exists(rev, path):
    if rev is None:
        return os.path.lexists(path)
    return subprocess.run(["git", "cat-file", "-e", f"{rev}:{path}"],
                          stderr=subprocess.DEVNULL).returncode == 0


def read(rev, path):
    return Path(path).read_text() if rev is None else git("show", f"{rev}:{path}") + "\n"


def load_manifest(rev):
    return json.loads(read(rev, MANIFEST))["features"]


def render(features):
    groups = {}
    for feature in features:
        if feature.get("readme", True):
            item = feature["summary"]
            if feature.get("docs"):
                item = f"[{item}]({feature['docs']})"
            groups.setdefault(feature["group"], []).append(item)
    return "\n".join(f"- **{group}:** {'; '.join(items)}." for group, items in groups.items())


def readme_with(text, features):
    start, end = text.index(START) + len(START), text.index(END)
    return text[:start] + "\n\n" + render(features) + "\n\n" + text[end:]


def check(rev, before):
    errors = []
    features = load_manifest(rev)
    ids = [feature["id"] for feature in features]
    errors += [f"duplicate feature id: {i}" for i in sorted({i for i in ids if ids.count(i) > 1})]
    listed = set()
    for feature in features:
        for key in ("id", "group", "summary"):
            if not feature.get(key):
                errors.append(f"{feature.get('id', '?')}: missing {key}")
        if not feature.get("tests"):
            errors.append(f"{feature['id']}: name at least one test that protects it")
        for path in feature.get("tests", []) + ([feature["docs"]] if feature.get("docs") else []):
            if not exists(rev, path):
                errors.append(f"{feature['id']}: {path} does not exist")
        listed.update(feature.get("tests", []))
    owned = fork_owned(rev)
    unlisted = sorted(path for path in owned if TEST.search(path) and path not in listed)
    if unlisted:
        errors.append("fork tests that belong to no feature in " + MANIFEST + ":\n  "
                      + "\n  ".join(unlisted))
    readme = read(rev, README)
    if START not in readme or END not in readme:
        errors.append(f"{README} lacks the {START} ... {END} feature list")
    elif readme_with(readme, features) != readme:
        errors.append(f"{README} feature list is stale: run python3 scripts/fork-feature-guard.py readme --write")
    if before:
        lost = sorted(path for path in fork_owned(before) if not exists(rev, path))
        if lost:
            errors.append("fork-owned files from " + before + " are missing; restore them "
                          "(retiring a feature is Egor's decision):\n  " + "\n  ".join(lost))
    for error in errors:
        print(f"Fork feature guard: {error}")
    if not errors:
        print(f"Fork feature guard passed: {len(features)} features, {len(listed)} protecting tests")
    return 1 if errors else 0


def footprint():
    path = Path(__file__).with_name("fork-footprint-budget.py")
    spec = importlib.util.spec_from_file_location("fork_footprint_budget", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.measure


def approval(rev, before):
    reasons = []
    owned = fork_owned(before)
    changed = git("diff", "--name-status", "--no-renames", before, rev).splitlines()
    tests = sorted(path for status, path in (row.split("\t", 1) for row in changed)
                   if path in owned and TEST.search(path) and status in ("M", "D"))
    if tests:
        stat = git("diff", "--stat=100", before, rev, "--", *tests)
        reasons.append("It changed fork-owned tests, which define fork features:\n\n```\n"
                       + stat + "\n```")
    guards = [path for path in GUARD_FILES
              if exists(before, path) and git("diff", "--name-only", before, rev, "--", path)]
    if guards:
        reasons.append("It changed guard files: " + ", ".join(f"`{path}`" for path in guards))
    measure = footprint()
    old, new = measure(upstream_base(before), before), measure(upstream_base(rev), rev)
    shrunk = sorted(f"`{path}`: {count} → {new.get(path, 0)} lines" for path, count in old.items()
                    if new.get(path, 0) < count)
    if shrunk:
        reasons.append("Fork changes in upstream files shrank, which can mean a partly dropped "
                       "feature:\n" + "\n".join(f"- {line}" for line in shrunk))
    print("\n\n".join(reasons))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["check", "approval", "readme"])
    parser.add_argument("--rev", help="commit to check (default: the working tree; approval: HEAD)")
    parser.add_argument("--before")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    os.chdir(git("rev-parse", "--show-toplevel"))
    if args.command == "check":
        return check(args.rev, args.before)
    if args.command == "approval":
        if not args.before:
            parser.error("approval needs --before")
        return approval(args.rev or "HEAD", args.before)
    features = json.loads(Path(MANIFEST).read_text())["features"]
    if args.write:
        Path(README).write_text(readme_with(Path(README).read_text(), features))
    else:
        print(render(features))
    return 0


if __name__ == "__main__":
    sys.exit(main())
