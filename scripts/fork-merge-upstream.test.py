#!/usr/bin/env python3
"""Exercise the fork merge policy against real Git merges in isolated repositories."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HELPER = Path(__file__).with_name("fork-merge-upstream.sh").resolve()


class ForkMergeTests(unittest.TestCase):
    def test_preserves_readme_and_merges_source(self):
        for appended in (False, True):
            with self.subTest(appended=appended), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                def git(*args):
                    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
                git("init", "-b", "main")
                git("config", "user.email", "test@example.invalid")
                git("config", "user.name", "Test")
                (root / "README.md").write_text("original\n")
                (root / "source.ts").write_text("original\n")
                git("add", ".")
                git("commit", "-m", "base")
                git("branch", "upstream")
                (root / "README.md").write_text("fork landing\n" if not appended else "original\n")
                (root / "fork.ts").write_text("fork feature\n")
                git("add", ".")
                git("commit", "-m", "fork")
                fork = git("rev-parse", "HEAD")
                git("switch", "upstream")
                (root / "README.md").write_text("upstream installs\n" if not appended else "original\nnew upstream installs\n")
                (root / "source.ts").write_text("upstream change\n")
                git("commit", "-am", "upstream")
                upstream = git("rev-parse", "HEAD")
                git("switch", "main")
                subprocess.run(["bash", str(HELPER), "upstream", "merge"], cwd=root, check=True, capture_output=True)
                self.assertEqual((root / "README.md").read_text(), git("show", f"{fork}:README.md") + "\n")
                self.assertEqual((root / "source.ts").read_text(), "upstream change\n")
                git("merge-base", "--is-ancestor", upstream, "HEAD")

    def test_source_conflicts_still_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
            git("init", "-b", "main")
            git("config", "user.email", "test@example.invalid")
            git("config", "user.name", "Test")
            for name in ("README.md", "source.ts"):
                (root / name).write_text("original\n")
            git("add", ".")
            git("commit", "-m", "base")
            git("branch", "upstream")
            for branch, content in (("main", "fork\n"), ("upstream", "upstream\n")):
                git("switch", branch)
                for name in ("README.md", "source.ts"):
                    (root / name).write_text(content)
                git("commit", "-am", branch)
            git("switch", "main")
            head = git("rev-parse", "HEAD")
            result = subprocess.run(["bash", str(HELPER), "upstream", "merge"], cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(git("rev-parse", "HEAD"), head)
            self.assertEqual(git("diff", "--name-only", "--diff-filter=U"), "source.ts")
            git("merge", "--abort")
            self.assertEqual(git("status", "--porcelain"), "")


    def diverge(self, root, files, fork, upstream):
        """Commit `files` as the base, then each side's edits on main and on upstream."""
        def git(*args):
            return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
        git("init", "-b", "main")
        git("config", "user.email", "test@example.invalid")
        git("config", "user.name", "Test")
        git("config", "rerere.enabled", "false")
        for name, content in {"README.md": "original\n", **files}.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(content)
        git("add", ".")
        git("commit", "-m", "base")
        git("branch", "upstream")
        for branch, edits in (("main", fork), ("upstream", upstream)):
            git("switch", branch)
            for name, content in edits.items():
                (root / name).write_text(content)
            git("commit", "-am", branch)
        git("switch", "main")
        return git

    def test_route_tree_takes_upstream_for_regeneration(self):
        tree = "apps/web/src/routeTree.gen.ts"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            git = self.diverge(root, {tree: "routes\n"}, {tree: "fork routes\n"}, {tree: "upstream routes\n"})
            subprocess.run(["bash", str(HELPER), "upstream", "merge"], cwd=root, check=True, capture_output=True)
            self.assertEqual((root / tree).read_text(), "upstream routes\n")
            self.assertIn("regenerates it", git("log", "-1", "--format=%B"))

    @unittest.skipUnless(shutil.which("mergiraf"), "mergiraf is not installed")
    def test_mergiraf_resolves_adjacent_imports(self):
        base = 'import { a } from "./a";\nimport { b } from "./b";\n\nexport const x = a + b;\n'
        fork = base.replace('"./a";\n', '"./a";\nimport { f } from "./f";\n')
        upstream = base.replace('"./a";\n', '"./a";\nimport { u } from "./u";\n')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            git = self.diverge(root, {"source.ts": base}, {"source.ts": fork}, {"source.ts": upstream})
            subprocess.run(["bash", str(HELPER), "upstream", "merge"], cwd=root, check=True, capture_output=True)
            merged = (root / "source.ts").read_text()
            self.assertIn('import { f } from "./f";', merged)
            self.assertIn('import { u } from "./u";', merged)
            self.assertNotIn("<<<<<<<", merged)
            self.assertIn("Resolved by mergiraf", git("log", "-1", "--format=%B"))
            self.assertIn("source.ts", git("log", "-1", "--format=%B"))

if __name__ == "__main__":
    unittest.main()
