#!/usr/bin/env python3
"""Request shapes and pagination of scripts/fork-jules.py, with the HTTP call replaced."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("fork_jules", Path(__file__).with_name("fork-jules.py"))
jules = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jules)


class JulesClientTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.pages = []

        def fake_call(method, path, body=None):
            self.calls.append((method, path, body))
            return self.pages.pop(0) if self.pages else {"name": "sessions/1"}

        self.original, jules.call = jules.call, fake_call

    def tearDown(self):
        jules.call = self.original

    def test_start_opens_a_pull_request_from_the_branch(self):
        with tempfile.NamedTemporaryFile("w", suffix=".md") as prompt:
            prompt.write("resolve")
            prompt.flush()
            self.assertEqual(jules.start("sources/github/o/r", "sync/conflicts-x", "T", prompt.name), "sessions/1")
        method, path, body = self.calls[0]
        self.assertEqual((method, path), ("POST", "/sessions"))
        self.assertEqual(body["automationMode"], "AUTO_CREATE_PR")
        self.assertEqual(body["sourceContext"]["githubRepoContext"]["startingBranch"], "sync/conflicts-x")
        self.assertEqual(body["prompt"], "resolve")

    def test_find_follows_pages_to_the_session_that_opened_the_pull_request(self):
        url = "https://github.com/o/r/pull/7"
        self.pages = [
            {"sessions": [{"name": "sessions/a", "outputs": []}], "nextPageToken": "t"},
            {"sessions": [{"name": "sessions/b", "outputs": [{"pullRequest": {"url": url}}]}]},
        ]
        self.assertEqual(jules.find(url), "sessions/b")
        self.assertEqual(self.calls[1][1], "/sessions?pageSize=100&pageToken=t")

    def test_find_reports_no_session(self):
        self.pages = [{"sessions": []}]
        self.assertIsNone(jules.find("https://github.com/o/r/pull/8"))


class ExcerptTests(unittest.TestCase):
    def test_keeps_failures_and_drops_noise_from_passing_tests(self):
        log = "\n".join([
            "merge\tchecks\t2026-10-27T12:12:04.9Z > vp typecheck (36 packages)  FAIL  95.4s",
            "merge\tchecks\t2026-10-27T12:12:05.0Z src/a.ts:115:65 - error TS2552: Cannot find name 'x'.",
            "merge\tchecks\t2026-10-27T12:12:06.0Z [Error: ResizeObserver loop completed with undelivered notifications.]",
            "merge\tchecks\t2026-10-27T12:12:07.0Z ^[[31m×^[[39m saves the scope ^[[2m48ms",
            *[f"merge\tchecks\t2026-10-27T12:13:{i:02}.0Z passing output {i}" for i in range(40)],
        ])
        with tempfile.NamedTemporaryFile("w", suffix=".log") as file:
            file.write(log)
            file.flush()
            lines = jules.excerpt(file.name, context=1)
        self.assertEqual(lines[0], "> vp typecheck (36 packages)  FAIL  95.4s")
        self.assertIn("src/a.ts:115:65 - error TS2552: Cannot find name 'x'.", lines)
        self.assertIn("× saves the scope 48ms", lines)
        self.assertFalse(any("ResizeObserver" in line or "passing output 39" in line for line in lines))

if __name__ == "__main__":
    unittest.main()
