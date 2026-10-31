#!/usr/bin/env python3
"""A rerun is offered only when the test step alone failed and every failed file is placed."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("failed", Path(__file__).with_name("fork-failed-tests.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ESC = "\x1b"


def log(steps, failed=()):
    summary = ["check:changed summary", *[f"  {kind}  {name}  {time}" for kind, name, time in steps]]
    detail = [
        f"{ESC}[41m{ESC}[1m FAIL {ESC}[22m @t3tools/web (browser) (chromium) {ESC}[39m {file}{ESC}[2m > {ESC}[22mname"
        for file in failed
    ]
    return "\n".join([*detail, *summary, "  CI also runs: full test suites, build"])


PASSING = [("pass", "lint", "8.1s"), ("pass", "typecheck (39 packages)", "66.8s")]


class FailedTestsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.directory.name)
        for package, test in (
            ("apps/web", "src/a.browser.test.tsx"),
            ("apps/server", "src/b.test.ts"),
            ("packages/shared", "src/b.test.ts"),
        ):
            (self.repo / package / "src").mkdir(parents=True, exist_ok=True)
            (self.repo / package / "package.json").write_text("{}")
            (self.repo / package / test).write_text("")

    def tearDown(self):
        self.directory.cleanup()

    def test_places_each_failed_file_in_its_package(self):
        text = log([*PASSING, ("FAIL", "test (453 files)", "846.2s")], ["src/a.browser.test.tsx"])
        self.assertEqual(module.failed_tests(text, self.repo), ["apps/web src/a.browser.test.tsx"])

    def test_reads_codes_written_as_text(self):
        text = log([*PASSING, ("FAIL", "test (453 files)", "846.2s")], ["src/a.browser.test.tsx"])
        text = text.replace(ESC + "[", "^[[")
        self.assertEqual(module.failed_tests(text, self.repo), ["apps/web src/a.browser.test.tsx"])

    def test_refuses_when_another_step_failed(self):
        text = log([("FAIL", "typecheck (39 packages)", "66.8s"), ("FAIL", "test (453 files)", "9s")], ["src/a.browser.test.tsx"])
        with self.assertRaisesRegex(SystemExit, "not only the test step"):
            module.failed_tests(text, self.repo)

    def test_refuses_a_killed_test_step(self):
        text = log([*PASSING, ("TIMEOUT", "test (453 files)", "killed after 900s")], ["src/a.browser.test.tsx"])
        with self.assertRaisesRegex(SystemExit, "not only the test step"):
            module.failed_tests(text, self.repo)

    def test_refuses_an_ambiguous_file(self):
        text = log([*PASSING, ("FAIL", "test (453 files)", "9s")], ["src/b.test.ts"])
        with self.assertRaisesRegex(SystemExit, "cannot place"):
            module.failed_tests(text, self.repo)

    def test_refuses_without_a_failed_file_or_summary(self):
        with self.assertRaisesRegex(SystemExit, "no failed test file"):
            module.failed_tests(log([*PASSING, ("FAIL", "test (453 files)", "9s")]), self.repo)
        with self.assertRaisesRegex(SystemExit, "no check:changed summary"):
            module.failed_tests("nothing here", self.repo)


if __name__ == "__main__":
    unittest.main()
