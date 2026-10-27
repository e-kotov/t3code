#!/usr/bin/env python3
"""Minimal client for the Jules REST API (alpha) used by .github/workflows/jules-sync.yml.

  start SOURCE BRANCH TITLE PROMPT_FILE  start a session that opens a pull request; prints its name
  find PR_URL                            print the session that opened PR_URL, or exit 1
  titled TEXT                            print the newest session whose title contains TEXT, or exit 1
  status SESSION                         print its state, whether it opened a pull request, and
                                         how many messages it has received
  send SESSION MESSAGE_FILE              add a message to a session
  excerpt LOG_FILE                       print the error lines of a GitHub Actions log

Reads JULES_API_KEY. API reference: https://developers.google.com/jules/api
"""
import json
import os
import re
import sys
import urllib.request

API = "https://jules.googleapis.com/v1alpha"


def call(method, path, body=None):
    request = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-Goog-Api-Key": os.environ["JULES_API_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    return json.loads(raw) if raw.strip() else {}


def start(source, branch, title, prompt_file):
    with open(prompt_file) as prompt:
        session = call("POST", "/sessions", {
            "prompt": prompt.read(),
            "title": title,
            "sourceContext": {"source": source, "githubRepoContext": {"startingBranch": branch}},
            "automationMode": "AUTO_CREATE_PR",
        })
    return session["name"]


def find(pr_url):
    for session in sessions():
        for output in session.get("outputs", []):
            if output.get("pullRequest", {}).get("url") == pr_url:
                return session["name"]
    return None


def sessions():
    token = ""
    while True:
        page = call("GET", "/sessions?pageSize=100" + (f"&pageToken={token}" if token else ""))
        yield from page.get("sessions", [])
        token = page.get("nextPageToken", "")
        if not token:
            return


def titled(text):
    matches = [session for session in sessions() if text in session.get("title", "")]
    return max(matches, key=lambda session: session.get("createTime", ""))["name"] if matches else None


def status(session):
    detail = call("GET", f"/{session}")
    pull_request = any("pullRequest" in output for output in detail.get("outputs", []))
    activities = call("GET", f"/{session}/activities?pageSize=100").get("activities", [])
    messages = sum(1 for activity in activities if activity.get("originator") == "user")
    return detail.get("state", "UNKNOWN"), pull_request, messages


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


def send(session, message_file):
    with open(message_file) as message:
        call("POST", f"/{session}:sendMessage", {"prompt": message.read()})


def main(argv):
    command, *args = argv
    if command == "start":
        print(start(*args))
    elif command == "find":
        name = find(*args)
        if name is None:
            return 1
        print(name)
    elif command == "titled":
        name = titled(*args)
        if name is None:
            return 1
        print(name)
    elif command == "status":
        state, pull_request, messages = status(*args)
        print(state, "pr" if pull_request else "no-pr", messages)
    elif command == "excerpt":
        print("\n".join(excerpt(*args)))
    elif command == "send":
        send(*args)
    else:
        raise SystemExit(f"unknown command {command}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
