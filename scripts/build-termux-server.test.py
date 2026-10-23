#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).with_name("build-termux-server.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class RecipeTests(unittest.TestCase):
    def test_packages_application_dependencies_from_single_or_multi_document_lockfiles(self):
        application = """lockfileVersion: '9.0'
importers:
  apps/server:
    dependencies:
      node-pty:
        version: 1.2.0-beta.15(patch_hash=x)
  apps/desktop:
    dependencies:
      ffi-rs:
        version: 1.3.2
"""
        metadata = """---
lockfileVersion: '9.0'
importers:
  .:
    packageManagerDependencies:
      pnpm:
        version: 12.14.0
---
"""
        for lockfile in (application, metadata + application):
            with self.subTest(multi_document=lockfile.startswith("---")):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    source = root / "bundle"
                    (source / "client").mkdir(parents=True)
                    (source / "bin.mjs").write_text("// server fixture\n")
                    (source / "client/index.html").write_text("<html></html>\n")
                    (root / "pnpm-lock.yaml").write_text(lockfile)
                    (root / "pnpm-workspace.yaml").write_text("{}\n")
                    output = root / "output"
                    # The parser and archive are real; Node selection and npm resolution are external.
                    with patch.object(bundle.subprocess, "check_output", return_value='["node-pty", "ffi-rs"]'), \
                            patch.object(bundle.subprocess, "run"):
                        bundle.build(root, source, output, "0.0.0-ek.1")
                    archive = output / "t3-0.0.0-ek.1-termux-arm64.tar.gz"
                    with tarfile.open(archive) as contents:
                        with contents.extractfile("package.json") as metadata_file:
                            package = json.load(metadata_file)
                        self.assertEqual(package["dependencies"], {
                            "node-pty": "1.2.0-beta.15", "ffi-rs": "1.3.2",
                        })
                        self.assertIn("dist/client/index.html", contents.getnames())
                    self.assertTrue(archive.with_name(archive.name + ".sha256").is_file())

    def test_rejects_missing_or_ambiguous_application_documents(self):
        application = "importers:\n  apps/server: {}\n  apps/desktop: {}\n"
        for lockfile in ("", "importers: {'.': {}}", application + "---\n" + application):
            with self.subTest(lockfile=lockfile):
                with self.assertRaisesRegex(ValueError, "exactly one lockfile document"):
                    bundle.application_lockfile(lockfile)

    def test_locked_versions_and_only_applicable_patches(self):
        lock = {"importers": {
            "apps/server": {"dependencies": {"node-pty": {"version": "1.2.0-beta.15(patch_hash=x)"}}},
            "apps/desktop": {"dependencies": {"ffi-rs": {"version": "1.3.2"}}},
        }}
        dependencies, patches = bundle.runtime_recipe(lock, {"patchedDependencies": {
            "node-pty@1.2.0-beta.15": "patches/pty.patch",
            "node-pty@1.1.0": "patches/old.patch",
            "other@2.0.0": "patches/other.patch",
        }}, ["node-pty", "ffi-rs"])
        self.assertEqual(dependencies, {"node-pty": "1.2.0-beta.15", "ffi-rs": "1.3.2"})
        self.assertEqual(patches, [{"package": "node-pty", "path": "patches/pty.patch"}])

    def test_non_registry_resolution_is_rejected(self):
        lock = {"importers": {"apps/server": {"dependencies": {"node-pty": {"version": "link:../pty"}}},
                              "apps/desktop": {"dependencies": {}}}}
        with self.assertRaises(ValueError):
            bundle.runtime_recipe(lock, {}, ["node-pty"])


if __name__ == "__main__":
    unittest.main()
