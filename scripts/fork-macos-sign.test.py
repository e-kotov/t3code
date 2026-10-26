"""Native regression: updated signed code can read the first build's Keychain item."""
import base64
import importlib.util
import os
from pathlib import Path
import plistlib
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("signing", Path(__file__).with_name("fork-macos-sign.py"))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)

FIXTURE = r'''
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    SecKeychainSetUserInteractionAllowed(false);
    SecKeychainRef keychain = NULL;
    OSStatus status = SecKeychainOpen(argv[1], &keychain);
    const char *service = "t3code-ek-signing-regression";
    const char *account = "fixture";
    const char *secret = "fixture-secret";
    if (!status && strcmp(argv[2], "write") == 0) {
        status = SecKeychainAddGenericPassword(keychain, strlen(service), service,
            strlen(account), account, strlen(secret), secret, NULL);
    } else if (!status) {
        UInt32 length = 0;
        void *value = NULL;
        status = SecKeychainFindGenericPassword(keychain, strlen(service), service,
            strlen(account), account, &length, &value, NULL);
        if (!status) {
            if (length != strlen(secret) || memcmp(value, secret, length) != 0) status = -1;
            SecKeychainItemFreeContent(NULL, value);
        }
    }
    if (keychain) CFRelease(keychain);
    printf("build %d: %d\n", REVISION, (int)status);
    return status ? 1 : 0;
}
'''

CASK_FIXTURE = r'''
class CaskFixture
  def method_missing(*)
  end
  def cask(_name, &block)
    instance_eval(&block)
  end
  def postflight_steps(&block)
    instance_eval(&block)
  end
  def run(command, args:)
    system(command, *args.map { |arg| arg.gsub("{{appdir}}", ARGV[1]) }, exception: true)
  end
end
CaskFixture.new.instance_eval(File.read(ARGV[0]))
'''


def fixture(root, version, revision):
    app = root / signing.APP_NAME
    executable = app / "Contents/MacOS/Fixture"
    executable.parent.mkdir(parents=True)
    (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": signing.APP_ID,
        "CFBundleExecutable": "Fixture",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": str(revision),
    }))
    source = root / "fixture.c"
    source.write_text(FIXTURE)
    signing.run("cc", "-Wno-deprecated-declarations", f"-DREVISION={revision}", source,
                "-framework", "Security", "-framework", "CoreFoundation", "-o", executable)
    return app, executable


@unittest.skipUnless(sys.platform == "darwin" and os.environ.get("FORK_MACOS_CERTIFICATE_BASE64"),
                     "Native signing/Keychain regression runs in the Mac signing job.")
class MacSigningTest(unittest.TestCase):
    def test_updated_build_retains_keychain_access_and_both_installers_keep_signatures(self):
        original_search_list = signing.run("security", "list-keychains", "-d", "user")
        certificate = base64.b64decode(os.environ["FORK_MACOS_CERTIFICATE_BASE64"], validate=True)
        with signing.scratch("t3code-ek-signing-test-") as directory:
            root = Path(directory)
            with signing.signing_keychain(certificate, os.environ["FORK_MACOS_CERTIFICATE_PASSWORD"]) as keychain:
                first, first_exe = fixture(root / "first", "0.1.0-ek.1", 1)
                updated, updated_exe = fixture(root / "updated", "0.1.0-ek.2", 2)
                signing.sign_app(first, keychain, "0.1.0-ek.1")
                signing.sign_app(updated, keychain, "0.1.0-ek.2")
                self.assertNotEqual(first_exe.read_bytes(), updated_exe.read_bytes())
                self.assertIn(b"build 1: 0", signing.run(first_exe, keychain, "write"))
                self.assertIn(b"build 2: 0", signing.run(updated_exe, keychain, "read"))
                before_install = updated_exe.read_bytes()
                signing.run("ruby", "-e", CASK_FIXTURE,
                            Path(__file__).with_name("fork-homebrew-cask.rb"), updated.parent)
                self.assertEqual(updated_exe.read_bytes(), before_install)
                self.assertIn(b"build 2: 0", signing.run(updated_exe, keychain, "read"))

                payload = root / "payload"
                payload.mkdir()
                signing.run("ditto", updated, payload / signing.APP_NAME)
                (payload / ".background").mkdir()
                (payload / ".background/fixture.txt").write_text("Installer layout must survive signing.")
                (payload / "Applications").symlink_to("/Applications")
                source = root / "source"
                source.mkdir()
                signing.run("hdiutil", "create", "-format", "UDZO", "-srcfolder", payload,
                            source / "T3-Code-0.1.0-ek.2-arm64.dmg")
                output = root / "signed"
                signing.package_installers(source, output, "0.1.0-ek.2", keychain)
                mountpoint = root / "mountpoint"
                mountpoint.mkdir()
                with signing.mounted(output / "T3-Code-0.1.0-ek.2-arm64.dmg", mountpoint):
                    self.assertEqual((mountpoint / ".background/fixture.txt").read_text(),
                                     "Installer layout must survive signing.")
                    self.assertTrue((mountpoint / "Applications").is_symlink())

                (updated / "Contents/Info.plist").write_bytes(b"tampered")
                with self.assertRaises(RuntimeError):
                    signing.run("codesign", "--verify", "--strict", updated)
                signing.run("codesign", "--force", "--sign", "-", first)
                with self.assertRaises(RuntimeError):
                    signing.verify_app(first, "0.1.0-ek.1")
                keychain_path = keychain
            self.assertFalse(keychain_path.exists())
        self.assertEqual(signing.run("security", "list-keychains", "-d", "user"), original_search_list)


if __name__ == "__main__":
    unittest.main()
