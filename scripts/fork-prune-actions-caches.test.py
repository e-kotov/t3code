"""Check that cache pruning selects only provably dead caches and deletes nothing on bad lookups."""
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
    def test_selects_only_setup_go_and_merged_pr_merge_caches(self):
        caches = [
            cache(1, "refs/heads/main", "setup-go-Linux-x64-ubuntu24-go-1.25-abc"),
            cache(2, "refs/pull/7/merge", "gradle-dependencies-v1-x"),
            cache(3, "refs/pull/8/merge", "gradle-dependencies-v1-y"),
            cache(4, "refs/pull/7/head", "gradle-home-v1|checks"),
            cache(5, "refs/heads/main", "gradle-dependencies-v1-z"),
            cache(6, "refs/heads/main", "fork-tailnet-so-v1-abc"),
        ]
        selected = prune.select_obsolete(caches, {"7": True, "8": False})
        self.assertEqual([(c["id"], reason) for c, reason in selected],
                         [(1, "setup-go"), (2, "merged PR #7")])

    def run_main(self, listing, pr_reply, total=None):
        """Run main() --delete against a fake gh; return (exit code, commands issued)."""
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if "DELETE" in command:
                return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
            if "/pulls/" in command[2]:
                if isinstance(pr_reply, Exception):
                    raise pr_reply
                return subprocess.CompletedProcess(command, 0, stdout=pr_reply + "\n")
            if "per_page=1" in command[2]:
                count = len(listing) if total is None else total
                return subprocess.CompletedProcess(command, 0, stdout=f"{count}\n")
            return subprocess.CompletedProcess(command, 0, stdout="\n".join(listing) + "\n")

        with mock.patch.object(prune.subprocess, "run", side_effect=run), \
                mock.patch("builtins.print"), mock.patch.dict(prune.os.environ, {}, clear=True):
            code = prune.main(["--repo", "o/r", "--delete"])
        return code, calls

    def test_bad_lookup_or_malformed_response_deletes_nothing(self):
        go = '{"id": 1, "ref": "refs/heads/main", "key": "setup-go-x", "size_in_bytes": 1}'
        pr7 = '{"id": 2, "ref": "refs/pull/7/merge", "key": "k", "size_in_bytes": 1}'
        merged = '{"number": 7, "merged": true}'
        cases = {
            "PR lookup fails": ([go, pr7], subprocess.CalledProcessError(1, [], stderr="HTTP 502"), None),
            "PR has no merged flag": ([go, pr7], '{"number": 7, "merged": null}', None),
            "PR reply for another number": ([go, pr7], '{"number": 8, "merged": true}', None),
            "cache without id": ([go, '{"ref": "refs/pull/7/merge", "key": "k", "size_in_bytes": 1}'],
                                 merged, None),
            "boolean cache id": ([go, pr7.replace('"id": 2', '"id": false')], merged, None),
            "cache record not an object": ([go, '["refs/pull/7/merge"]'], merged, None),
            "malformed size": ([go, pr7.replace('"size_in_bytes": 1', '"size_in_bytes": "big"')],
                               merged, None),
            "duplicate cache ids": ([go, go.replace("setup-go-x", "setup-go-y")], merged, None),
            "count mismatch": ([go, pr7], merged, 3),
            "boolean total": ([go], merged, "true"),
        }
        for name, (listing, pr_reply, total) in cases.items():
            with self.subTest(name):
                code, calls = self.run_main(listing, pr_reply, total)
                self.assertEqual(code, 1)
                self.assertFalse([c for c in calls if "DELETE" in c])

    def test_only_merged_pr_caches_are_deleted(self):
        pr7 = '{"id": 2, "ref": "refs/pull/7/merge", "key": "k", "size_in_bytes": 1}'
        code, calls = self.run_main([pr7], '{"number": 7, "merged": false}')
        self.assertEqual(code, 0)
        self.assertFalse([c for c in calls if "DELETE" in c])
        lookup = next(c for c in calls if "/pulls/" in c[2])
        self.assertIn(".merged", lookup[-1])

        code, calls = self.run_main([pr7], '{"number": 7, "merged": true}')
        self.assertEqual(code, 0)
        self.assertEqual([c[-1] for c in calls if "DELETE" in c], ["repos/o/r/actions/caches/2"])


if __name__ == "__main__":
    unittest.main()
