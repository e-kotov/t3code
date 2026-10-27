"""Exercise the footprint gate against real Git histories, without project dependencies."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("fork-footprint-budget.py").resolve()


class FootprintBudgetTest(unittest.TestCase):
    def test_growth_shrinkage_new_mounts_and_unmerged_upstream(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            def commit():
                git("add", ".")
                git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                    "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")

            git("init", "-q")
            (root / "mount.ts").write_text("upstream\n")
            (root / "untouched.ts").write_text("upstream\n")
            (root / "README.md").write_text("upstream installation\n")
            commit()
            upstream = git("rev-parse", "HEAD")
            git("update-ref", "refs/remotes/upstream/main", upstream)
            (root / "mount.ts").write_text("upstream\nfork mount\n")
            (root / "scripts").mkdir()
            shutil.copyfile(SCRIPT, root / "scripts/fork-footprint-budget.py")
            (root / "fork-owned.ts").write_text("independent fork implementation\n")
            (root / "README.md").write_text("fork installation\n")
            commit()
            env = {k: v for k, v in os.environ.items() if k != "UPSTREAM_SHA"}

            def gate(*args, success=True):
                result = subprocess.run(["python3", "scripts/fork-footprint-budget.py", *args],
                                        cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
                return result.stdout

            gate("--write")
            self.assertEqual(json.loads((root / "scripts/fork-footprint-budget.json").read_text()),
                             {"files": {"mount.ts": 1}})
            gate()
            # README is deliberately fork-owned; source mounts remain budgeted below.
            (root / "README.md").write_text("fork guide\n" * 100)
            commit()
            gate()
            # A fetched upstream-only change must not consume the fork's budget.
            tree = git("rev-parse", upstream + "^{tree}")
            other = subprocess.check_output(
                ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                 "commit-tree", tree, "-p", upstream, "-m", "unmerged upstream"], cwd=root, text=True).strip()
            git("update-ref", "refs/remotes/upstream/main", other)
            gate()
            (root / "mount.ts").write_text("upstream\nfork mount\nmore fork logic\n")
            commit()
            self.assertIn("mount.ts: 2 > 1", gate(success=False))
            gate("--write")
            # Resetting only fixture files is safe; no developer checkout is involved.
            # Growth in one file and a partial shrink in another are both reported.
            (root / "mount.ts").write_text("upstream\nfork mount\n")
            (root / "untouched.ts").write_text("upstream\nnew mount\n")
            commit()
            output = gate(success=False)
            self.assertIn("untouched.ts: 1 > 0", output)
            self.assertIn("mount.ts: 1 < 2", output)
            self.assertIn("may have been dropped", output)
            # A fully reverted mount leaves no diff row but must still be caught.
            (root / "mount.ts").write_text("upstream\n")
            (root / "untouched.ts").write_text("upstream\n")
            commit()
            output = gate(success=False)
            self.assertIn("mount.ts: 0 < 2", output)
            self.assertNotIn("untouched.ts", output)
            gate("--write")
            self.assertEqual(json.loads((root / "scripts/fork-footprint-budget.json").read_text()),
                             {"files": {}})
            gate()
            (root / "untouched.ts").unlink()
            commit()
            self.assertIn("untouched.ts: 1 > 0", gate(success=False))


if __name__ == "__main__":
    unittest.main()
