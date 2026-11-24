#!/usr/bin/env python3
"""Reject new telemetry senders in shipped code, and keep fork analytics hard-off; update only after review."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

# Telemetry vendors and endpoints, matched case-insensitively in shipped (non-test) source.
PATTERNS = {
    "amplitude": r"amplitude\.com|@amplitude/",
    "axiom": r"axiom\.co|x-axiom",
    "bugsnag": r"bugsnag",
    "datadog": r"datadoghq|@datadog/",
    "expo-observe": r"expo-observe",
    "honeycomb": r"honeycomb\.io",
    "logrocket": r"logrocket",
    "mixpanel": r"mixpanel",
    "newrelic": r"newrelic|nr-data\.net",
    "posthog": r"posthog",
    "posthog-key": r"phc_[a-z0-9]{20,}",
    "rollbar": r"rollbar\.com|@rollbar/",
    "segment": r"api\.segment\.(io|com)|@segment/",
    "sentry": r"sentry\.io|@sentry/",
    "statsig": r"statsig",
    "t3-ingest": r"ingest\.t3\.codes",
}
SCOPE = [
    "apps/server/src",
    "apps/desktop/src",
    "apps/web/src",
    "apps/mobile/src",
    "apps/mobile/app.config.ts",
    ":(glob)packages/*/src/**",
]
TEST_PATH = re.compile(r"\.test\.|\.spec\.|/__tests__/|/test/|/fixtures?/")
# Analytics, and agent feedback that travels through it, stay off whatever upstream changes.
INVARIANTS = {
    "apps/server/src/telemetry/ForkTelemetryPolicy.ts": "Config.succeed(false)",
    "apps/server/src/telemetry/AnalyticsService.ts": "ForkTelemetryPolicy.enabled",
}
BASELINE = "scripts/fork-telemetry-guard.json"


def git(*args, check=True):
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result


def scan(rev):
    """Matching line count per shipped file and pattern at rev."""
    found = {}
    for name, pattern in PATTERNS.items():
        # git grep exits 1 when nothing matches.
        rows = git("grep", "-c", "-i", "-E", pattern, rev, "--", *SCOPE, check=False).stdout
        for row in rows.splitlines():
            path, count = row[len(rev) + 1:].rsplit(":", 1)
            if not TEST_PATH.search(path):
                found.setdefault(path, {})[name] = int(count)
    return {path: dict(sorted(names.items())) for path, names in sorted(found.items())}


def broken_invariants(rev):
    broken = []
    for path, needle in INVARIANTS.items():
        shown = git("show", f"{rev}:{path}", check=False)
        if shown.returncode != 0 or needle not in shown.stdout:
            broken.append(f"{path} no longer contains {needle}")
    return broken


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="record a reviewed baseline")
    parser.add_argument("--rev", default="HEAD")
    args = parser.parse_args()
    os.chdir(git("rev-parse", "--show-toplevel").stdout.strip())
    current = scan(args.rev)
    if args.write:
        Path(BASELINE).write_text(json.dumps({"files": current}, indent=2) + "\n")
        print(f"Recorded telemetry references in {len(current)} files")
        return 0
    baseline = json.loads(Path(BASELINE).read_text())["files"]
    grown = [
        f"{path}: {name} {count} > {baseline.get(path, {}).get(name, 0)}"
        for path, names in current.items()
        for name, count in names.items()
        if count > baseline.get(path, {}).get(name, 0)
    ]
    broken = broken_invariants(args.rev)
    if grown:
        print("New telemetry references in shipped code:\n" + "\n".join(grown))
        print(f"Have Egor review each one; only then record them with --write in {BASELINE}.")
    if broken:
        print("Fork analytics are no longer forced off:\n" + "\n".join(broken))
    if grown or broken:
        return 1
    print(f"Telemetry guard passed: no new telemetry references in {len(current)} known files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
