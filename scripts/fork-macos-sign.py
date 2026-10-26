#!/usr/bin/env python3
"""Sign the fork's Mac installers without changing the upstream packager."""
import argparse
import base64
from contextlib import contextmanager
import os
from pathlib import Path
import plistlib
import secrets
import shlex
import subprocess
import tempfile

APP_ID = "pro.ekotov.t3code"
APP_NAME = "T3 Code EK.app"
CERTIFICATE_SHA1 = "6eea3d76ac584a617c48490ba138e98da1f4aa78"
REQUIREMENT = f'identifier "{APP_ID}" and certificate root = H"{CERTIFICATE_SHA1}"'
MACHO_MAGICS = {
    bytes.fromhex(value)
    for value in ("feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")
}


def run(*arguments):
    result = subprocess.run([str(arg) for arg in arguments], capture_output=True)
    if result.returncode:
        # security's arguments include passwords; never include argv in errors.
        raise RuntimeError(f"{arguments[0]} failed: {result.stderr.decode(errors='replace')}")
    return result.stdout


def scratch(prefix):
    root = Path(os.environ.get("RUNNER_TEMP", str(Path.home() / "tmp")))
    root.mkdir(parents=True, exist_ok=True)
    return tempfile.TemporaryDirectory(prefix=prefix, dir=root)


@contextmanager
def signing_keychain(certificate, password):
    original = shlex.split(run("security", "list-keychains", "-d", "user").decode())
    with scratch("t3code-ek-signing-") as directory:
        root = Path(directory)
        keychain = root / "signing.keychain-db"
        archive = root / "certificate.p12"
        archive.write_bytes(certificate)
        archive.chmod(0o600)
        keychain_password = secrets.token_urlsafe(40)
        created = False
        try:
            run("security", "create-keychain", "-p", keychain_password, keychain)
            created = True
            # codesign also locates the private key through the user search list.
            run("security", "list-keychains", "-d", "user", "-s", keychain, *original)
            run("security", "set-keychain-settings", "-lut", "21600", keychain)
            run("security", "unlock-keychain", "-p", keychain_password, keychain)
            run("security", "import", archive, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign")
            run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychain_password, keychain)
            identities = run("security", "find-certificate", "-a", "-Z", keychain).decode().lower()
            if f"sha-1 hash: {CERTIFICATE_SHA1}" not in identities:
                raise ValueError("The Mac signing secret does not contain the pinned fork certificate.")
            yield keychain
        finally:
            try:
                if created:
                    run("security", "delete-keychain", keychain)
            finally:
                run("security", "list-keychains", "-d", "user", "-s", *original)


def verify_app(app, version):
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != APP_ID or info.get("CFBundleShortVersionString") != version:
        raise ValueError("Mac installer identity or version does not match the selected release.")
    run("codesign", "--verify", "--deep", "--strict", "-R", f"={REQUIREMENT}", app)


def sign_app(app, keychain, version):
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    if info.get("CFBundleIdentifier") != APP_ID or info.get("CFBundleShortVersionString") != version:
        raise ValueError("Refusing to sign an unexpected app or version.")
    paths = [path for path in app.rglob("*") if not path.is_symlink()]
    for path in paths:
        if path.is_file():
            with path.open("rb") as stream:
                magic = stream.read(4)
            if magic in MACHO_MAGICS:
                run("codesign", "--force", "--sign", CERTIFICATE_SHA1, "--keychain", keychain,
                    "--timestamp=none", "--preserve-metadata=identifier,entitlements", path)
    bundles = [path for path in paths if path.is_dir() and path.suffix in (".app", ".framework", ".xpc")]
    for path in sorted(bundles, key=lambda item: len(item.parts), reverse=True) + [app]:
        run("codesign", "--force", "--sign", CERTIFICATE_SHA1, "--keychain", keychain,
            "--timestamp=none", "--preserve-metadata=entitlements", path)
    verify_app(app, version)


@contextmanager
def mounted(dmg, mountpoint):
    run("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mountpoint, dmg)
    try:
        yield mountpoint
    finally:
        run("hdiutil", "detach", mountpoint)


def package_installers(source, output, version, keychain):
    name = f"T3-Code-{version}-arm64"
    output.mkdir(parents=True, exist_ok=True)
    with scratch("t3code-ek-installers-") as directory:
        root = Path(directory)
        payload = root / "payload"
        mountpoint = root / "mounted"
        mountpoint.mkdir()
        with mounted(source / f"{name}.dmg", mountpoint):
            run("ditto", mountpoint, payload)
        app = payload / APP_NAME
        sign_app(app, keychain, version)
        run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, output / f"{name}.zip")
        run("hdiutil", "create", "-ov", "-format", "UDZO", "-volname", f"T3 Code EK {version} Installer",
            "-srcfolder", payload, output / f"{name}.dmg")
        with mounted(output / f"{name}.dmg", mountpoint):
            verify_app(mountpoint / APP_NAME, version)
        extracted = root / "extracted"
        run("ditto", "-x", "-k", output / f"{name}.zip", extracted)
        verify_app(extracted / APP_NAME, version)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    certificate = base64.b64decode(os.environ["FORK_MACOS_CERTIFICATE_BASE64"], validate=True)
    password = os.environ["FORK_MACOS_CERTIFICATE_PASSWORD"]
    if not certificate or not password:
        raise ValueError("Both persistent Mac signing secrets are required.")
    with signing_keychain(certificate, password) as keychain:
        package_installers(args.source.resolve(), args.output.resolve(), args.version, keychain)
    print(f"Verified DMG and ZIP for {args.version}; signer {CERTIFICATE_SHA1}.")


if __name__ == "__main__":
    main()
