#!/usr/bin/env python3
"""Exercise Claude recovery with a broken lockfile; --live uses real Claude and pnpm in CI."""
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = yaml.safe_load((ROOT / ".github/workflows/claude-sync.yml").read_text())
STEPS = WORKFLOW["jobs"]["resolve"]["steps"]
LIVE = "--live" in sys.argv
if LIVE:
    sys.argv.remove("--live")


def step_with_id(identifier):
    return next(step for step in STEPS if step.get("id") == identifier)


class ClaudeSyncTests(unittest.TestCase):
    def command(self, *args, check=True):
        return subprocess.run(args, cwd=self.root, env=self.env, text=True,
                              capture_output=True, check=check)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.temp = Path(self.temporary.name)
        self.root = self.temp / "candidate"
        self.runtime = self.temp / "runtime"
        self.bin = self.temp / "bin"
        for directory in (self.root, self.runtime, self.bin):
            directory.mkdir()
        self.env = dict(os.environ, RUNNER_TEMP=str(self.runtime), CI="true",
                        CLAUDE_MODEL=os.environ.get("CLAUDE_MODEL", WORKFLOW["env"]["CLAUDE_MODEL"]),
                        VP_GIT_HOOKS="0", PATH=str(self.bin) + os.pathsep + os.environ["PATH"])
        for name in ("GITHUB_PATH", "GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"):
            path = self.runtime / name
            path.touch()
            self.env[name] = str(path)
        self.env["CLAUDE_CODE_VERSION"] = WORKFLOW["env"]["CLAUDE_CODE_VERSION"]
        self.expected = self.runtime / "expected-lock.yaml"
        self.env["EXPECTED_LOCK"] = str(self.expected)
        if not LIVE:
            self.executable("npm", 'touch "$RUNNER_TEMP/cli-installed"')
            self.executable("vp", r'''if ! cmp -s pnpm-lock.yaml "$EXPECTED_LOCK"; then
  echo 'ERR_PNPM_INCONSISTENT_PATCH_HASH: lockfile disagrees with patchedDependencies' >&2
  exit 1
fi
touch "$RUNNER_TEMP/dependencies-installed"
''')
            self.executable("claude", r'''python3 - "$@" <<'PYTHON'
import json, os, pathlib, sys
runtime = pathlib.Path(os.environ["RUNNER_TEMP"])
assert (runtime / "cli-installed").exists(), "Claude must install independently"
if os.environ.get("EXPECT_FAILED_INSTALL") == "1":
    assert not (runtime / "dependencies-installed").exists()
    assert "ERR_PNPM_INCONSISTENT_PATCH_HASH" in sys.argv[sys.argv.index("-p") + 1]
(runtime / "claude-ran").touch()
if os.environ.get("LEAVE_BROKEN") != "1":
    pathlib.Path("pnpm-lock.yaml").write_text(pathlib.Path(os.environ["EXPECTED_LOCK"]).read_text())
print(json.dumps({"result": "Fixture repair attempted", "subtype": "success"}))
PYTHON
''')
        prompt = self.root / ".github/claude/fix-upstream-sync.md"
        prompt.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / ".github/claude/fix-upstream-sync.md", prompt)
        (self.root / ".gitignore").write_text("node_modules/\n.session-node-version\n")
        (self.root / "AGENTS.md").write_text(
            "Repair only pnpm-lock.yaml. Preserve the local dependency and its patch. "
            "Run vp install to verify the repair. Do not edit other files.\n")
        skill = self.root / ".agents/skills/fork-development/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("Preserve the configured dependency patch. Resolve the lockfile and verify installation.\n")
        package = json.loads((ROOT / "package.json").read_text())
        fixture_package = {"name": "recovery-fixture", "private": True,
                           "packageManager": package["packageManager"], "engines": package["engines"]}
        if LIVE:
            fixture_package["dependencies"] = {"bootstrap-fixture": "file:bootstrap-fixture.tgz"}
            with tarfile.open(self.root / "bootstrap-fixture.tgz", "w:gz") as archive:
                for name, content in {
                    "package/package.json": json.dumps({"name": "bootstrap-fixture", "version": "1.0.0"}),
                    "package/index.js": "export const answer = 1;\n",
                }.items():
                    data = content.encode()
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
            patches = self.root / "patches"
            patches.mkdir()
            (patches / "bootstrap-fixture.patch").write_text(
                "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n"
                "@@ -1 +1 @@\n-export const answer = 1;\n+export const answer = 2;\n")
            (self.root / "pnpm-workspace.yaml").write_text(
                "packages: []\npatchedDependencies:\n  bootstrap-fixture@1.0.0: patches/bootstrap-fixture.patch\n")
        else:
            (self.root / "pnpm-workspace.yaml").write_text("packages: []\n")
        (self.root / "package.json").write_text(json.dumps(fixture_package))
        if LIVE:
            self.command("vp", "install", "--no-frozen-lockfile", "--ignore-scripts")
            shutil.rmtree(self.root / "node_modules")
            self.expected.write_text((self.root / "pnpm-lock.yaml").read_text())
        else:
            self.expected.write_text("lockfileVersion: '9.0'\nimporters: {}\n")
            (self.root / "pnpm-lock.yaml").write_text(self.expected.read_text())
        self.command("git", "init", "-q", "-b", "main")
        self.command("git", "config", "user.name", "Recovery test")
        self.command("git", "config", "user.email", "recovery@example.invalid")
        self.command("git", "config", "core.hooksPath", "/dev/null")
        self.command("git", "add", ".")
        self.command("git", "commit", "-qm", "clean base")
        self.command("git", "update-ref", "refs/remotes/origin/main", "HEAD")
        (self.runtime / "context.md").write_text(
            "\n## This run\nRepair the dependency lockfile; preserve its configured patch.\n"
            "This isolated fixture has no application test scripts or footprint budget. "
            "Verify the repair with vp install --frozen-lockfile.\n")

    def executable(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body + "\n")
        path.chmod(0o755)

    def run_step(self, step):
        directory = self.runtime if step.get("working-directory") == "${{ runner.temp }}" else self.root
        result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", step["run"]],
                                cwd=directory, env=self.env, text=True, capture_output=True)
        for line in Path(self.env["GITHUB_PATH"]).read_text().splitlines():
            if line not in self.env["PATH"].split(os.pathsep):
                self.env["PATH"] = line + os.pathsep + self.env["PATH"]
        return result

    def install_then_fix(self):
        first = next(i for i, step in enumerate(STEPS) if "npm install" in step.get("run", ""))
        fix = next(i for i, step in enumerate(STEPS) if step.get("id") == "fix")
        for step in STEPS[first:fix]:
            if "run" not in step:
                continue
            result = self.run_step(step)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = self.command("bash", str(ROOT / "scripts/claude-sync.sh"), "fix", "2", check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        if LIVE:
            reply = json.loads((self.runtime / "claude-fix.json").read_text())
            report = "Claude recovery smoke: " + json.dumps({
                "model": self.env["CLAUDE_MODEL"], "result": reply.get("subtype"),
                "cost_usd": reply.get("total_cost_usd"), "budget_usd": 2,
            })
            print(report, flush=True)
            summary = os.environ.get("GITHUB_STEP_SUMMARY")
            if summary:
                with open(summary, "a") as output:
                    output.write(report + "\n")
        else:
            self.assertTrue((self.runtime / "claude-ran").exists())
        return self.run_step(step_with_id("verify-dependencies"))

    def break_lockfile(self):
        lock = self.expected.read_text()
        if LIVE:
            lock, count = re.subn(r"patch_hash=[a-f0-9]+", "patch_hash=" + "0" * 64, lock)
            self.assertGreater(count, 0, "Fixture must contain patched dependency references")
        else:
            lock = "broken patch hash\n"
        (self.root / "pnpm-lock.yaml").write_text(lock)
        self.command("git", "commit", "-qam", "inconsistent merge lockfile")
        self.env["EXPECT_FAILED_INSTALL"] = "1"

    def test_broken_lockfile_reaches_claude_and_must_pass_frozen_install(self):
        self.break_lockfile()
        failed = self.command("vp", "install", check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("ERR_PNPM_INCONSISTENT_PATCH_HASH", failed.stdout + failed.stderr)
        result = self.install_then_fix()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / "pnpm-lock.yaml").exists())
        if LIVE:
            patched = self.root / "node_modules/bootstrap-fixture/index.js"
            self.assertEqual(patched.read_text(), "export const answer = 2;\n")

    @unittest.skipIf(LIVE, "The live smoke exercises one bounded repair only")
    def test_unrepaired_lockfile_blocks_validation(self):
        self.break_lockfile()
        self.env["LEAVE_BROKEN"] = "1"
        result = self.install_then_fix()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ERR_PNPM_INCONSISTENT_PATCH_HASH", result.stdout + result.stderr)

    @unittest.skipIf(LIVE, "The live smoke exercises one bounded repair only")
    def test_already_installable_candidate_still_reaches_claude(self):
        result = self.install_then_fix()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipIf(LIVE, "Covered locally without a model call")
    def test_toolchain_uses_clean_main_when_candidate_manifest_is_conflicted(self):
        (self.root / "package.json").write_text("<<<<<<< ours\ninvalid manifest\n>>>>>>> theirs\n")
        result = self.run_step(step_with_id("bootstrap"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        bootstrap = self.runtime / "claude-bootstrap"
        self.assertEqual(json.loads((bootstrap / "package.json").read_text())["name"], "recovery-fixture")
        setup = next(step for step in STEPS if step.get("uses", "").startswith("voidzero-dev/setup-vp@"))
        self.assertEqual(setup["with"]["working-directory"], "${{ runner.temp }}/claude-bootstrap")
        self.assertFalse(setup["with"]["run-install"])
        self.assertFalse(setup["with"]["cache"])

    @unittest.skipIf(LIVE, "Covered locally without a model call")
    def test_decision_request_is_logged_and_saved_without_rebuilding(self):
        question = "Choose upstream ACP 1.4.1 or keep the fork pin.\n"
        (self.root / ".claude-needs-decision.md").write_text(question)
        self.env.update(MERGE="HEAD", VERDICT="approve", FOLLOW_UP="unused", MODE="fix")
        step = next(step for step in STEPS if step.get("name") == "Rebuild one merge commit")
        result = self.run_step(step)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(question, result.stdout)
        self.assertIn(question, Path(self.env["GITHUB_STEP_SUMMARY"]).read_text())
        self.assertFalse((self.runtime / "resolved.bundle").exists())
        decision_artifact = next(step for step in STEPS
                                 if step.get("with", {}).get("name") == "claude-decision")
        self.assertIn("always()", decision_artifact["if"])
        self.assertEqual(decision_artifact["with"]["path"],
                         ".claude-needs-decision.md")
        self.assertTrue(decision_artifact["with"]["include-hidden-files"])
        self.assertEqual((self.root / decision_artifact["with"]["path"]).read_text(), question)


if __name__ == "__main__":
    unittest.main()
