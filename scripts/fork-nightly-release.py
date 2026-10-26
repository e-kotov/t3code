#!/usr/bin/env python3
"""Plan a new EK nightly from the checked-out commit and the published release ledger."""
from datetime import datetime, timezone
import json
import os
import re
import subprocess

EK_TAG = re.compile(r"v(\d+\.\d+\.\d+)-ek\.(\d+)")
NIGHTLY_TAG = re.compile(r"v(\d+\.\d+\.\d+)-nightly\..+")


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def plan(head, merged_tags, all_tags, releases, resolve_tag, *, today=None):
    for release in releases:
        tag = release.get("tag_name", "")
        if not release.get("draft") and EK_TAG.fullmatch(tag) and resolve_tag(tag) == head:
            return {"changed": False, "sha": head, "reason": "This commit already has a published EK release."}
    base = next((match[1] for tag in merged_tags if (match := NIGHTLY_TAG.fullmatch(tag))), None)
    if base is None:
        raise ValueError("No incorporated upstream nightly tag establishes the base version.")
    numbers = [int(match[2]) for tag in all_tags
               if (match := EK_TAG.fullmatch(tag)) and match[1] == base]
    day = today if today is not None else datetime.now(timezone.utc).date()
    floor = int(day.strftime("%Y%m%d")) * 10000
    revision = max(floor, max(numbers, default=0)) + 1
    if revision >= floor + 10000:
        raise ValueError("EK date counter exhausted or a future tag exists; check the UTC clock.")
    version = f"{base}-ek.{revision}"
    return {"changed": True, "sha": head, "version": version, "tag": f"v{version}",
            "reason": "Changed commit requires validation before publication."}


def main():
    repo = os.environ.get("GITHUB_REPOSITORY", "e-kotov/t3code")
    pages = json.loads(subprocess.check_output(
        ["gh", "api", "--paginate", "--slurp", f"repos/{repo}/releases?per_page=100"], text=True))
    result = plan(
        git("rev-parse", "HEAD"),
        git("tag", "--merged", "HEAD", "--sort=-v:refname", "--list", "v*-nightly.*").splitlines(),
        git("tag", "--list", "v*-ek.*").splitlines(),
        [release for page in pages for release in page],
        lambda tag: git("rev-parse", f"{tag}^{{commit}}"),
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
