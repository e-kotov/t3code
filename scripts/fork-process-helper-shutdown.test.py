"""A preflight helper blocked in a syscall must not prevent server process exit."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux-only nonblocking spawner")
class HelperShutdownTest(unittest.TestCase):
    def test_parent_exits_when_kill_does_not_produce_child_exit(self):
        module = (ROOT / "apps/server/src/process/forkIsolatedAccess.ts").as_uri()
        with tempfile.TemporaryDirectory(prefix="fork-helper-shutdown-") as directory:
            root = Path(directory)
            fifo = root / "fifo"
            os.mkfifo(fifo)
            pid_file = root / "helper.pid"
            preload = root / "preload.cjs"
            preload.write_text('''const fs=require('node:fs'),cp=require('node:child_process');
const originalAccess=fs.accessSync, originalKill=cp.ChildProcess.prototype.kill, originalSpawn=cp.spawn;
// accessSync on a FIFO does not block; substitute a real blocking syscall only for this fixture.
fs.accessSync=(path,mode)=>String(path)===FIFO?fs.openSync(path,0):originalAccess(path,mode);
cp.spawn=(...args)=>{const child=originalSpawn(...args);if(args[1]?.includes('__fork-access'))fs.writeFileSync(PID,String(child.pid));return child;};
// Model a kernel-blocked child: a successful kill request need not produce an exit event.
cp.ChildProcess.prototype.kill=function(...args){return this.spawnargs.includes('__fork-access')?true:originalKill.apply(this,args);};
require('node:module').syncBuiltinESMExports();
'''.replace("FIFO", json.dumps(str(fifo))).replace("PID", json.dumps(str(pid_file))))
            main = root / "main.mjs"
            main.write_text(
                'import {access} from ' + json.dumps(module) + ';\n'
                'try{await access(' + json.dumps(str(fifo)) + ',0);}'
                'catch(e){console.log("helper result",e.code);}\n'
                'console.log("main complete");\n')
            environment = dict(os.environ, NODE_OPTIONS="--require=" + str(preload))
            try:
                result = subprocess.run(
                    ["timeout", "--kill-after=1s", "9s", "node", str(main)],
                    cwd=ROOT, env=environment, capture_output=True, text=True, timeout=12)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("helper result ETIMEDOUT", result.stdout)
                self.assertIn("main complete", result.stdout)
                self.assertTrue(pid_file.exists(), "The actual helper must have spawned")
            finally:
                # This PID is written by this fixture's spawn hook, never discovered globally.
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass


if __name__ == "__main__":
    unittest.main()
