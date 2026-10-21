#!/usr/bin/env python3
"""Package the shared server bundle for installation by native ARM64 Termux."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def runtime_recipe(lock, workspace, names):
    dependencies = {}
    # ffi-rs is also used through fff; pin it to the desktop's tested version.
    server = lock["importers"]["apps/server"]["dependencies"]
    desktop = lock["importers"]["apps/desktop"]["dependencies"]
    for name in names:
        entry = server.get(name) or desktop.get(name)
        version = entry["version"].split("(", 1)[0]
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.-]+)?", version):
            raise ValueError(f"Not a registry version: {name}@{version}")
        dependencies[name] = version
    patches = []
    for selector, path in workspace.get("patchedDependencies", {}).items():
        name, _, version = selector.rpartition("@")
        if dependencies.get(name) == version:
            patches.append({"package": name, "path": path})
    return dependencies, patches


def build(repo, bundle, output, version):
    import yaml

    if not re.fullmatch(r"\d+\.\d+\.\d+-ek\.\d+", version):
        raise ValueError("Expected MAJOR.MINOR.PATCH-ek.NUMBER")
    if not (bundle / "bin.mjs").is_file() or not (bundle / "client/index.html").is_file():
        raise ValueError("Expected built server and web UI")
    lock = yaml.safe_load((repo / "pnpm-lock.yaml").read_text())
    workspace = yaml.safe_load((repo / "pnpm-workspace.yaml").read_text())
    candidates = dict(lock["importers"]["apps/server"]["dependencies"])
    candidates["ffi-rs"] = lock["importers"]["apps/desktop"]["dependencies"]["ffi-rs"]
    # Use the bundler's canonical external selector instead of a second package list.
    selector = (repo / "scripts/lib/cli-external-packages.ts").as_uri()
    code = (f'import {{ selectCliRuntimeExternalDependencies as select }} from {json.dumps(selector)};'
            'process.stdout.write(JSON.stringify(Object.keys(select(JSON.parse(process.argv[1])))));')
    names = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code,
                                                json.dumps(candidates)], text=True))
    dependencies, patches = runtime_recipe(lock, workspace, names)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="t3-termux-") as temporary:
        stage = Path(temporary)
        shutil.copytree(bundle, stage / "dist", ignore=shutil.ignore_patterns("*.map"))
        package = {"name": "t3-termux-runtime", "version": version, "private": True,
                   "type": "module", "dependencies": dependencies}
        (stage / "package.json").write_text(json.dumps(package, indent=2) + "\n")
        for patch in patches:
            destination = stage / patch["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(repo / patch["path"], destination)
        recipe = {"format": 1, "version": version, "platform": "android", "arch": "arm64",
                  "patches": patches}
        (stage / "termux.json").write_text(json.dumps(recipe, indent=2) + "\n")
        # Resolve on CI, install on Android. No Linux native binaries enter the archive.
        subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts",
                        "--os=android", "--cpu=arm64", "--no-audit", "--no-fund"],
                       cwd=stage, check=True)
        archive = output / f"t3-{version}-termux-arm64.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            for child in sorted(stage.iterdir()):
                stream.add(child, arcname=child.name)
        digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
        archive.with_name(archive.name + ".sha256").write_text(f"{digest}  {archive.name}\n")
        print(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    build(args.repo.resolve(), args.bundle.resolve(), args.output.resolve(), args.version)
