#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).with_name("build-termux-server.py"))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class RecipeTests(unittest.TestCase):
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
