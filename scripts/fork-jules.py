#!/usr/bin/env python3
"""Minimal client for the Jules REST API (alpha) used by .github/workflows/jules-sync.yml.

  start SOURCE BRANCH TITLE PROMPT_FILE  start a session that opens a pull request; prints its name
  find PR_URL                            print the session that opened PR_URL, or exit 1
  send SESSION MESSAGE_FILE              add a message to a session

Reads JULES_API_KEY. API reference: https://developers.google.com/jules/api
"""
import json
import os
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
    token = ""
    while True:
        page = call("GET", "/sessions?pageSize=100" + (f"&pageToken={token}" if token else ""))
        for session in page.get("sessions", []):
            for output in session.get("outputs", []):
                if output.get("pullRequest", {}).get("url") == pr_url:
                    return session["name"]
        token = page.get("nextPageToken", "")
        if not token:
            return None


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
    elif command == "send":
        send(*args)
    else:
        raise SystemExit(f"unknown command {command}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
