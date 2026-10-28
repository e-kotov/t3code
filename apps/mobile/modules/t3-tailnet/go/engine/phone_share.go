package engine

import (
	"context"
	"net"
)

// phoneShare only forwards the phone's T3 server; it never exposes arbitrary ports.
type phoneShare struct{ forward *forward }

func (s *phoneShare) close() { s.forward.close() }

func newPhoneShare(ln net.Listener, dial dialFunc, touch func(), logf func(string, ...any)) *phoneShare {
	f := &forward{
		target: "127.0.0.1:3774", ln: ln, dial: dial,
		touch: touch, logf: logf, conns: map[net.Conn]struct{}{},
	}
	go f.serve()
	return &phoneShare{forward: f}
}

// StartPhoneShare exposes port 3774 on the app's tailnet node to the phone's
// loopback T3 server. Tailscale ACLs and T3's own authentication both apply.
func (e *Engine) StartPhoneShare() error {
	e.mu.Lock()
	srv := e.srv
	if srv == nil {
		e.mu.Unlock()
		return ErrStopped
	}
	if e.share != nil {
		e.mu.Unlock()
		return nil
	}
	e.mu.Unlock()

	ln, err := srv.Listen("tcp", ":3774")
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.srv != srv {
		_ = ln.Close()
		return ErrStopped
	}
	if e.share != nil {
		_ = ln.Close()
		return nil
	}
	e.share = newPhoneShare(ln,
		func(ctx context.Context, network, address string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, address)
		},
		e.touch, e.logs.Logf)
	e.logs.Logf("engine: sharing phone T3 on tailnet port 3774")
	return nil
}

func (e *Engine) StopPhoneShare() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.share != nil {
		e.share.close()
		e.share = nil
		e.touch()
	}
}
