// Package engine runs an embedded Tailscale node for the T3 mobile app and
// forwards loopback TCP ports to tailnet addresses. It needs no system VPN,
// so it works alongside whatever VPN the phone already runs.
package engine

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"tailscale.com/tsnet"
)

// Config describes one engine run.
type Config struct {
	// StateDir keeps the node identity, so a restart does not sign in again.
	StateDir string
	// Hostname is the node name shown in the Tailscale admin console.
	Hostname string
	// IdleTimeout stops the engine once no forwarded connection has been open
	// for this long. Zero keeps it running until Stop.
	IdleTimeout time.Duration
	// Ephemeral registers a node that Tailscale removes once it goes offline.
	// Used by development checks, not by the app.
	Ephemeral bool
}

// Status is the engine state reported to the app.
type Status struct {
	// State is one of stopped, starting, needs-login, needs-approval, running.
	State     string          `json:"state"`
	AuthURL   string          `json:"authUrl,omitempty"`
	Name      string          `json:"name,omitempty"`
	Addresses []string        `json:"addresses,omitempty"`
	Error     string          `json:"error,omitempty"`
	Forwards  []ForwardStatus `json:"forwards"`
}

// ForwardStatus describes one loopback forward.
type ForwardStatus struct {
	Target string `json:"target"`
	Port   int    `json:"port"`
	Active int    `json:"active"`
}

// ErrStopped is returned by Forward while the engine is not started.
var ErrStopped = errors.New("built-in Tailscale is not running")

// Engine owns at most one tsnet node and its forwards.
type Engine struct {
	mu       sync.Mutex
	srv      *tsnet.Server
	forwards map[string]*forward
	share    *phoneShare
	// ports remembers each target's port across restarts, so a client that
	// kept the old address reconnects once the engine is back.
	ports   map[string]int
	lastErr string
	stopped chan struct{}

	idleTimeout atomic.Int64 // nanoseconds
	lastUse     atomic.Int64 // unix nanoseconds
	logs        *Ring
}

// New returns a stopped engine that logs into logs.
func New(logs *Ring) *Engine {
	return &Engine{forwards: map[string]*forward{}, ports: map[string]int{}, logs: logs}
}

// SetIdleTimeout updates an existing node without starting a new one.
func (e *Engine) SetIdleTimeout(timeout time.Duration) {
	e.idleTimeout.Store(int64(timeout))
	e.touch()
}

// Start starts the node if it is stopped. On a running engine it only
// updates the idle timeout.
func (e *Engine) Start(cfg Config) (err error) {
	e.idleTimeout.Store(int64(cfg.IdleTimeout))
	e.touch()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.srv != nil {
		return nil
	}
	if cfg.StateDir == "" {
		return errors.New("state directory is required")
	}
	// An Android app process has no $HOME, temp directory or working
	// directory that tailscale could fall back to, and it panics without one.
	logsDir := filepath.Join(cfg.StateDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		e.lastErr = err.Error()
		return err
	}
	os.Setenv("TS_LOGS_DIR", logsDir)
	srv := &tsnet.Server{
		Dir:       cfg.StateDir,
		Hostname:  cfg.Hostname,
		Ephemeral: cfg.Ephemeral,
		UserLogf:  e.logs.Logf,
		Logf:      e.logs.Logf,
	}
	// A panic in tailscale would otherwise take the whole app down.
	defer func() {
		if r := recover(); r != nil {
			_ = srv.Close()
			err = fmt.Errorf("tailscale failed to start: %v", r)
			e.lastErr = err.Error()
			e.logs.Logf("engine: %v", err)
		}
	}()
	if err := srv.Start(); err != nil {
		e.lastErr = err.Error()
		_ = srv.Close()
		return err
	}
	e.srv = srv
	e.lastErr = ""
	e.stopped = make(chan struct{})
	go e.idleLoop(srv, e.stopped)
	e.logs.Logf("engine: started as %q", cfg.Hostname)
	return nil
}

// Stop closes every forward and the node. The identity stays on disk.
func (e *Engine) Stop(reason string) {
	e.mu.Lock()
	srv := e.srv
	e.stopLocked()
	e.mu.Unlock()
	if srv != nil {
		e.logs.Logf("engine: stopping (%s)", reason)
		_ = srv.Close()
	}
}

func (e *Engine) stopLocked() {
	if e.share != nil {
		e.share.close()
		e.share = nil
	}
	for target, f := range e.forwards {
		f.close()
		delete(e.forwards, target)
	}
	if e.stopped != nil {
		close(e.stopped)
		e.stopped = nil
	}
	e.srv = nil
}

// stopIf stops the engine only if srv is still the running node.
func (e *Engine) stopIf(srv *tsnet.Server, reason string) {
	e.mu.Lock()
	if e.srv != srv {
		e.mu.Unlock()
		return
	}
	e.stopLocked()
	e.mu.Unlock()
	e.logs.Logf("engine: stopping (%s)", reason)
	_ = srv.Close()
}

// Logout signs the node out and stops it. The next Start asks for a new login.
func (e *Engine) Logout(ctx context.Context) error {
	e.mu.Lock()
	srv := e.srv
	e.mu.Unlock()
	if srv == nil {
		return ErrStopped
	}
	lc, err := srv.LocalClient()
	if err == nil {
		err = lc.Logout(ctx)
	}
	e.Stop("signed out")
	return err
}

// Status reports the node state, the pending login URL and the forwards.
func (e *Engine) Status(ctx context.Context) Status {
	e.mu.Lock()
	srv := e.srv
	st := Status{Error: e.lastErr, Forwards: e.forwardStatusLocked()}
	e.mu.Unlock()
	if srv == nil {
		st.State = "stopped"
		return st
	}
	lc, err := srv.LocalClient()
	if err != nil {
		st.State = "starting"
		st.Error = err.Error()
		return st
	}
	s, err := lc.StatusWithoutPeers(ctx)
	if err != nil {
		st.State = "starting"
		st.Error = err.Error()
		return st
	}
	st.State = stateName(s.BackendState)
	st.AuthURL = s.AuthURL
	if s.Self != nil {
		st.Name = strings.TrimSuffix(s.Self.DNSName, ".")
	}
	for _, ip := range s.TailscaleIPs {
		st.Addresses = append(st.Addresses, ip.String())
	}
	return st
}

// WaitReady waits until the node runs, or needs the user, or ctx ends.
// A forward is only worth offering once the node runs: a reachability check
// through a node that is still connecting would time out.
func (e *Engine) WaitReady(ctx context.Context) Status {
	for {
		st := e.Status(ctx)
		switch {
		case st.State == "running", st.State == "stopped", st.State == "needs-approval",
			st.State == "needs-login" && st.AuthURL != "":
			return st
		}
		select {
		case <-ctx.Done():
			return st
		case <-time.After(200 * time.Millisecond):
		}
	}
}

// Forward returns the loopback port that forwards to target ("host:port"
// on the tailnet), opening it if needed.
func (e *Engine) Forward(target string) (int, error) {
	if _, _, err := net.SplitHostPort(target); err != nil {
		return 0, fmt.Errorf("invalid target %q: %w", target, err)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.srv == nil {
		return 0, ErrStopped
	}
	if f := e.forwards[target]; f != nil {
		return f.port, nil
	}
	f, err := listenForward(target, e.ports[target], e.srv.Dial, e.touch, e.logs.Logf)
	if err != nil {
		return 0, err
	}
	e.forwards[target] = f
	e.ports[target] = f.port
	e.touch()
	return f.port, nil
}

func (e *Engine) forwardStatusLocked() []ForwardStatus {
	out := make([]ForwardStatus, 0, len(e.forwards))
	for _, f := range e.forwards {
		out = append(out, ForwardStatus{Target: f.target, Port: f.port, Active: int(f.active.Load())})
	}
	return out
}

func (e *Engine) touch() { e.lastUse.Store(time.Now().UnixNano()) }

func (e *Engine) busy() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.share != nil {
		return true
	}
	for _, f := range e.forwards {
		if f.active.Load() > 0 {
			return true
		}
	}
	return false
}

func (e *Engine) idleLoop(srv *tsnet.Server, stopped <-chan struct{}) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopped:
			return
		case <-ticker.C:
		}
		idle := time.Since(time.Unix(0, e.lastUse.Load()))
		if idle >= loginTimeout && !e.running(srv) {
			e.stopIf(srv, "sign-in not completed")
			return
		}
		timeout := time.Duration(e.idleTimeout.Load())
		if timeout <= 0 || e.busy() {
			continue
		}
		if idle >= timeout {
			e.stopIf(srv, "idle")
			return
		}
	}
}

// loginTimeout stops a node that has waited this long for a sign-in that
// never came, such as an abandoned login page.
const loginTimeout = 10 * time.Minute

func (e *Engine) running(srv *tsnet.Server) bool {
	lc, err := srv.LocalClient()
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	st, err := lc.StatusWithoutPeers(ctx)
	return err == nil && st.BackendState == "Running"
}

func stateName(backend string) string {
	switch backend {
	case "Running":
		return "running"
	case "NeedsLogin":
		return "needs-login"
	case "NeedsMachineAuth":
		return "needs-approval"
	default:
		return "starting"
	}
}
