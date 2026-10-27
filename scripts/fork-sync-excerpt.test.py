#!/usr/bin/env python3
"""The failure excerpt keeps error lines and drops noise from passing tests."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("excerpt", Path(__file__).with_name("fork-sync-excerpt.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


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
            lines = module.excerpt(file.name, context=1)
        self.assertEqual(lines[0], "> vp typecheck (36 packages)  FAIL  95.4s")
        self.assertIn("src/a.ts:115:65 - error TS2552: Cannot find name 'x'.", lines)
        self.assertIn("× saves the scope 48ms", lines)
        self.assertFalse(any("ResizeObserver" in line or "passing output 39" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
