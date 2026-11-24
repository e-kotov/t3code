"""Exercise the telemetry guard against a real Git history, without project dependencies."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("fork-telemetry-guard.py").resolve()
POLICY = "apps/server/src/telemetry/ForkTelemetryPolicy.ts"
ANALYTICS = "apps/server/src/telemetry/AnalyticsService.ts"


class TelemetryGuardTest(unittest.TestCase):
    def test_new_senders_and_policy_changes_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            def write(path, text):
                (root / path).parent.mkdir(parents=True, exist_ok=True)
                (root / path).write_text(text)

            def commit():
                git("add", ".")
                git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                    "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")

            def guard(*args):
                return subprocess.run(["python3", "scripts/fork-telemetry-guard.py", *args],
                                      cwd=root, capture_output=True, text=True)

            git("init", "-q")
            (root / "scripts").mkdir()
            shutil.copyfile(SCRIPT, root / "scripts/fork-telemetry-guard.py")
            write(POLICY, "export const enabled = Config.succeed(false);\n")
            write(ANALYTICS, 'enabled: ForkTelemetryPolicy.enabled,\nhost: "https://ingest.t3.codes",\n')
            commit()
            self.assertEqual(guard("--write").returncode, 0)
            commit()
            self.assertEqual(guard().returncode, 0, guard().stdout)

            # Tests may name vendors; only shipped code counts.
            write("apps/web/src/analytics.test.ts", 'import posthog from "posthog-js";\n')
            commit()
            self.assertEqual(guard().returncode, 0)

            # A second sender to a known endpoint, from another file.
            write("apps/web/src/report.ts", 'fetch("https://ingest.t3.codes/batch/");\n')
            commit()
            result = guard()
            self.assertEqual(result.returncode, 1)
            self.assertIn("apps/web/src/report.ts: t3-ingest 1 > 0", result.stdout)
            git("rm", "-q", "apps/web/src/report.ts")
            commit()

            # A new vendor added beside the known one in the same file.
            write(ANALYTICS, 'enabled: ForkTelemetryPolicy.enabled,\nhost: "https://ingest.t3.codes",\n'
                  'sentry: "https://o1.ingest.sentry.io",\n')
            commit()
            self.assertIn("sentry 1 > 0", guard().stdout)

            # A reviewed baseline accepts it.
            self.assertEqual(guard("--write").returncode, 0)
            self.assertEqual(guard().returncode, 0)

            # Upstream turning analytics back on fails even with no new endpoint.
            write(POLICY, 'export const enabled = Config.Boolean("T3CODE_TELEMETRY_ENABLED");\n')
            commit()
            result = guard()
            self.assertEqual(result.returncode, 1)
            self.assertIn("no longer contains Config.succeed(false)", result.stdout)


if __name__ == "__main__":
    unittest.main()
