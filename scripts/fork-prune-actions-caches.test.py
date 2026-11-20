"""Check that cache pruning selects only provably dead caches and deletes nothing on bad lookups."""
import importlib.util
import json
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


def cache(cache_id, ref, key, size=2**20):
    return {"id": cache_id, "ref": ref, "key": key, "size_in_bytes": size}


GO = cache(1, "refs/heads/main", "setup-go-x")
PR7 = cache(2, "refs/pull/7/merge", "k")
CLOSED = {"number": 7, "state": "closed", "merged": False}
MERGED = {"number": 7, "state": "closed", "merged": True}


def page(caches, total=None):
    return {"total_count": len(caches) if total is None else total, "actions_caches": caches}


class PruneActionsCachesTest(unittest.TestCase):
    def run_main(self, listing, pr_reply=MERGED, delete_error=None):
        """Run main() --delete against a fake gh returning raw JSON text; return (code, commands)."""
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if "DELETE" in command:
                if isinstance(delete_error, Exception):
                    raise delete_error
                code = 1 if delete_error == "silent" else 0
                return subprocess.CompletedProcess(command, code, stdout="", stderr="")
            if isinstance(pr_reply, Exception) and "/pulls/" in command[-1]:
                raise pr_reply
            body = listing if "/caches" in command[-1] else pr_reply
            text = body if isinstance(body, str) else json.dumps(body)
            return subprocess.CompletedProcess(command, 0, stdout=text, stderr="")

        with mock.patch.object(prune.subprocess, "run", side_effect=run), \
                mock.patch("builtins.print"), mock.patch.dict(prune.os.environ, {}, clear=True):
            code = prune.main(["--repo", "o/r", "--delete"])
        return code, calls

    def deletes(self, calls):
        return [c[-1] for c in calls if "DELETE" in c]

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

    def test_only_merged_pr_caches_are_deleted(self):
        code, calls = self.run_main([page([PR7])], CLOSED)
        self.assertEqual((code, self.deletes(calls)), (0, []))
        code, calls = self.run_main([page([PR7])], MERGED)
        self.assertEqual((code, self.deletes(calls)), (0, ["repos/o/r/actions/caches/2"]))
        self.assertFalse([c for c in calls if "--jq" in c])

    def test_bad_lookup_or_malformed_response_deletes_nothing(self):
        cases = {
            "PR lookup fails": ([page([GO, PR7])], subprocess.CalledProcessError(1, [], stderr="502")),
            "PR has no merged flag": ([page([GO, PR7])], {"number": 7, "merged": None}),
            "PR reply for another number": ([page([GO, PR7])], dict(MERGED, number=8)),
            "cache without id": ([page([GO, {"ref": "refs/pull/7/merge", "key": "k",
                                              "size_in_bytes": 1}])], MERGED),
            "boolean cache id": ([page([GO, dict(PR7, id=False)])], MERGED),
            "huge float cache id": ([page([GO, dict(PR7, id=2.0**60)])], MERGED),
            "cache record is a JSON string": ([page([GO, json.dumps(PR7)])], MERGED),
            "float size": ([page([GO, dict(PR7, size_in_bytes=1.0)])], MERGED),
            "boolean size": ([page([GO, dict(PR7, size_in_bytes=True)])], MERGED),
            "duplicate cache ids": ([page([GO, dict(GO, key="setup-go-y")])], MERGED),
            "count mismatch": ([page([GO, PR7], total=3)], MERGED),
            "string count": ([page([GO], total="1")], MERGED),
            "pages disagree on count": ([page([GO], total=2), page([PR7], total=3)], MERGED),
            "listing not JSON": ("not json", MERGED),
            "duplicate PR fields": ([page([GO, PR7])],
                                    '{"number": 7, "merged": false, "merged": true}'),
            "lone surrogate in a key": (json.dumps([page([GO])]).replace("setup-go-x", "setup-go-\\ud800"),
                                        MERGED),
        }
        for name, (listing, pr_reply) in cases.items():
            with self.subTest(name):
                code, calls = self.run_main(listing, pr_reply)
                self.assertEqual((code, self.deletes(calls)), (1, []))

    def test_failed_delete_stops_the_run(self):
        two = [page([GO, dict(GO, id=9, key="setup-go-y")])]
        for name, error in {"gh cannot launch": OSError("gh missing"),
                            "gh fails silently": "silent"}.items():
            with self.subTest(name):
                code, calls = self.run_main(two, delete_error=error)
                self.assertEqual((code, len(self.deletes(calls))), (1, 1))


if __name__ == "__main__":
    unittest.main()
