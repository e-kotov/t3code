"""Check that cache pruning selects only provably dead caches and deletes nothing on lookup failure."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location(
    "prune", Path(__file__).with_name("fork-prune-actions-caches.py"))
prune = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prune)


def cache(cache_id, ref, key):
    return {"id": cache_id, "ref": ref, "key": key, "size_in_bytes": 2**20}


class PruneActionsCachesTest(unittest.TestCase):
    def test_selects_only_setup_go_and_closed_pr_merge_caches(self):
        caches = [
            cache(1, "refs/heads/main", "setup-go-Linux-x64-ubuntu24-go-1.25-abc"),
            cache(2, "refs/pull/7/merge", "gradle-dependencies-v1-x"),
            cache(3, "refs/pull/8/merge", "gradle-dependencies-v1-y"),
            cache(4, "refs/pull/7/head", "gradle-home-v1|checks"),
            cache(5, "refs/heads/main", "gradle-dependencies-v1-z"),
            cache(6, "refs/heads/main", "fork-tailnet-so-v1-abc"),
        ]
        selected = prune.select_obsolete(caches, {"7": "closed", "8": "open"})
        self.assertEqual([(c["id"], reason) for c, reason in selected],
                         [(1, "setup-go"), (2, "closed PR #7")])

    def test_lookup_failure_deletes_nothing(self):
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if "/pulls/" in command[-3]:
                raise subprocess.CalledProcessError(1, command, stderr="HTTP 502")
            if "per_page=1" in command[2]:
                return subprocess.CompletedProcess(command, 0, stdout="1\n")
            line = '{"id": 2, "ref": "refs/pull/7/merge", "key": "k", "size_in_bytes": 1}\n'
            return subprocess.CompletedProcess(command, 0, stdout=line)

        with mock.patch.object(prune.subprocess, "run", side_effect=run), \
                mock.patch("builtins.print"), mock.patch.dict(prune.os.environ, {}, clear=True):
            self.assertEqual(prune.main(["--repo", "o/r", "--delete"]), 1)
        self.assertFalse([c for c in calls if "DELETE" in c])


if __name__ == "__main__":
    unittest.main()
