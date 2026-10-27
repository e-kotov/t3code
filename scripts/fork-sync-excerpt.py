#!/usr/bin/env python3
"""Print the error lines of a GitHub Actions log (`gh run view --log-failed`), with a little
context, for an agent that has to fix the failure. The log's tail is mostly output of passing
tests, so this picks the failures instead.

  fork-sync-excerpt.py LOG_FILE
"""
import re
import sys

# Lines that name a failure, and noise that passing tests print around them.
FAILURE = re.compile(
    r"error TS\d+|\bFAIL\b|×|Error:|Error\b.*:|Fork edits grew|##\[error\]|exceeds|not found",
)
NOISE = re.compile(r"ResizeObserver|ConnectionTransientError|\bWARN\b|ExperimentalWarning|^\s*at ")
TIMESTAMP = re.compile(r"^(?:[^\t]*\t){2}\ufeff?\d{4}-\d\d-\d\dT[\d:.]+Z ")


def excerpt(log_file, limit=120, context=3):
    lines = []
    with open(log_file, errors="replace") as log:
        for raw in log:
            # GitHub writes terminal colour codes as ESC or as a literal "^[".
            line = re.sub(r"(?:\x1b|\^\[)\[[0-9;]*m", "", TIMESTAMP.sub("", raw.rstrip("\n")))
            if line.strip():
                lines.append(line)
    picked, seen = [], set()
    for index, line in enumerate(lines):
        if not FAILURE.search(line) or NOISE.search(line):
            continue
        for follow in lines[index:index + 1 + context]:
            if follow not in seen and not NOISE.search(follow):
                seen.add(follow)
                picked.append(follow)
        if len(picked) >= limit:
            break
    return picked[:limit]


if __name__ == "__main__":
    print("\n".join(excerpt(sys.argv[1])))
