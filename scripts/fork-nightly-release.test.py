"""Check nightly selection against real annotated tags and independent upstream history."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("nightly", Path(__file__).with_name("fork-nightly-release.py"))
nightly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nightly)


class NightlyReleaseTest(unittest.TestCase):
    def test_release_ledger_and_unmerged_nightly_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.check_output(["git", "-c", "user.name=Test", "-c",
                                               "user.email=test@example.invalid", *args],
                                              cwd=root, text=True).strip()

            def commit(text):
                (root / "source").write_text(text)
                git("add", ".")
                git("-c", "core.hooksPath=/dev/null", "commit", "-qm", text)
                return git("rev-parse", "HEAD")

            git("init", "-q")
            base = commit("upstream")
            git("tag", "v0.1.1-nightly.20261020.3411")
            git("tag", "-a", "v0.1.1-ek.1", "-m", "published checkpoint")
            head = commit("fork changes")
            git("tag", "-a", "v0.1.1-ek.7", "-m", "failed build still reserves a version")
            git("checkout", "-q", "--detach", base)
            commit("new unmerged upstream")
            git("tag", "v0.2.0-nightly.20261021.1")
            git("checkout", "-q", "--detach", head)
            releases = [{"tag_name": "v0.1.1-ek.1", "draft": False}]

            def plan():
                return nightly.plan(head, git("tag", "--merged", "HEAD", "--sort=-v:refname").splitlines(),
                                    git("tag").splitlines(), releases,
                                    lambda tag: git("rev-parse", f"{tag}^{{commit}}"))

            self.assertEqual(plan()["version"], "0.1.1-ek.8")
            git("tag", "-a", "v0.1.1-ek.8", "-m", "draft")
            releases.append({"tag_name": "v0.1.1-ek.8", "draft": True})
            self.assertEqual(plan()["version"], "0.1.1-ek.9")
            releases[-1]["draft"] = False
            self.assertFalse(plan()["changed"])
            with self.assertRaisesRegex(ValueError, "No incorporated upstream nightly"):
                nightly.plan(head, [], [], [], lambda tag: "")


if __name__ == "__main__":
    unittest.main()
