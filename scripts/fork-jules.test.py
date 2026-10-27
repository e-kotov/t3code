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


if __name__ == "__main__":
    unittest.main()
