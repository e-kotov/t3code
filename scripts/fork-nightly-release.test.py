"""Check nightly selection against real annotated tags and independent upstream history."""
from datetime import date
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
                                    lambda tag: git("rev-parse", f"{tag}^{{commit}}"), today=date(2026, 10, 26))

            self.assertEqual(plan()["version"], "0.1.1-ek.202610260001")
            git("tag", "-a", "v0.1.1-ek.202610260001", "-m", "draft")
            releases.append({"tag_name": "v0.1.1-ek.202610260001", "draft": True})
            self.assertEqual(plan()["version"], "0.1.1-ek.202610260002")
            releases[-1]["draft"] = False
            self.assertFalse(plan()["changed"])
            with self.assertRaisesRegex(ValueError, "No incorporated upstream nightly"):
                nightly.plan(head, [], [], [], lambda tag: "")

    def test_date_counter_reserves_failed_tags_and_rolls_over_at_utc_midnight(self):
        def version(tags, day=date(2026, 10, 26)):
            return nightly.plan("head", ["v0.1.3-nightly.20261026.1"], tags, [],
                                lambda _: "", today=day)["version"]

        self.assertEqual(version(["v0.1.3-ek.12"]), "0.1.3-ek.202610260001")
        tags = ["v0.1.3-ek.202610260009", "v0.1.3-ek.202610260010",
                "v0.1.4-ek.202610260099"]
        self.assertEqual(version(tags), "0.1.3-ek.202610260011")
        self.assertEqual(version(tags, date(2026, 10, 27)), "0.1.3-ek.202610270001")
        with self.assertRaisesRegex(ValueError, "date counter"):
            version(["v0.1.3-ek.202610269999"])
        with self.assertRaisesRegex(ValueError, "date counter"):
            version(["v0.1.3-ek.202610270001"])
        versions = [version([]), version(["v0.1.3-ek.202610260008"]),
                    version(["v0.1.3-ek.202610260009"]), version(tags)]
        self.assertEqual(sorted(versions), versions)


if __name__ == "__main__":
    unittest.main()
