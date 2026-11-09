"""Exercise the fork feature guard against real Git histories, without project dependencies."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).parent.resolve()


class FeatureGuardTest(unittest.TestCase):
    def test_manifest_readme_survival_and_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            def commit():
                git("add", "-A")
                git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                    "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")
                return git("rev-parse", "HEAD")

            def guard(*args, success=True):
                result = subprocess.run(["python3", "scripts/fork-feature-guard.py", *args],
                                        cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
                return result.stdout

            def manifest(tests):
                (root / "scripts/fork-features.json").write_text(json.dumps({"features": [
                    {"id": "mount", "group": "Tools", "summary": "a fork mount", "tests": tests},
                ]}))

            git("init", "-q")
            (root / "mount.ts").write_text("upstream\n")
            (root / "README.md").write_text("upstream\n")
            commit()
            git("update-ref", "refs/remotes/upstream/main", "HEAD")
            (root / "scripts").mkdir()
            for name in ("fork-feature-guard.py", "fork-footprint-budget.py"):
                shutil.copyfile(HERE / name, root / "scripts" / name)
            (root / "mount.ts").write_text("upstream\nfork mount\nfork mount 2\n")
            (root / "feature.ts").write_text("fork feature\n")
            (root / "feature.test.ts").write_text("expect(feature).toBe(true)\n")
            manifest(["feature.test.ts"])
            (root / "README.md").write_text(
                "# Fork\n\n<!-- fork-features:start -->\n<!-- fork-features:end -->\n")
            self.assertIn("feature list is stale", guard("check", success=False))
            guard("readme", "--write")
            self.assertIn("- **Tools:** a fork mount.", (root / "README.md").read_text())
            self.assertIn("1 features, 1 protecting tests", guard("check"))
            main = commit()
            guard("check", "--rev", main)

            # An unregistered fork test fails, also before it is committed.
            (root / "other.test.ts").write_text("expect(other).toBe(true)\n")
            self.assertIn("belong to no feature in scripts/fork-features.json:\n  other.test.ts",
                          guard("check", success=False))
            (root / "other.test.ts").unlink()
            manifest(["feature.test.ts", "gone.test.ts"])
            self.assertIn("mount: gone.test.ts does not exist", guard("check", success=False))
            manifest(["feature.test.ts"])

            # A resolution that deletes a fork-owned file fails against the main it started from.
            (root / "feature.ts").unlink()
            lost = commit()
            output = guard("check", "--before", main, "--rev", lost, success=False)
            self.assertIn("missing; restore them", output)
            self.assertIn("  feature.ts", output)
            guard("check", "--rev", lost)
            self.assertEqual(guard("approval", "--before", main, "--rev", lost), "\n")

            # Fork test edits, guard file edits and mount shrinkage need approval.
            git("checkout", "-q", main)
            (root / "feature.test.ts").write_text("expect(feature).toBeDefined()\n")
            (root / "mount.ts").write_text("upstream\nfork mount\n")
            manifest(["feature.test.ts", "feature.ts"])
            edited = commit()
            output = guard("approval", "--before", main, "--rev", edited)
            self.assertIn("changed fork-owned tests", output)
            self.assertIn("feature.test.ts", output)
            self.assertIn("guard files: `scripts/fork-features.json`", output)
            self.assertIn("`mount.ts`: 2 → 1 lines", output)


if __name__ == "__main__":
    unittest.main()
