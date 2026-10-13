package engine

import (
	"testing"
	"time"
)

// An Android app process has no $HOME, no usable temp directory and "/" as
// its working directory, so tailscale finds nowhere to keep its logs unless
// the engine names a directory.
func TestStartWithoutHomeOrTempDir(t *testing.T) {
	state := t.TempDir()
	t.Setenv("HOME", "")
	t.Setenv("XDG_CACHE_HOME", "")
	t.Setenv("TMPDIR", "/nonexistent")
	t.Setenv("TS_LOGS_DIR", "")
	t.Chdir("/")

	e := New(NewRing(50))
	if err := e.Start(Config{StateDir: state, Hostname: "t3-engine-test", IdleTimeout: time.Minute, Ephemeral: true}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	e.Stop("test")
}
