package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// dialTimeout bounds one tailnet dial, so a dead peer fails the client's
// connection instead of leaving it hanging.
const dialTimeout = 20 * time.Second

type dialFunc func(ctx context.Context, network, address string) (net.Conn, error)

// forward copies each loopback connection to one tailnet address.
type forward struct {
	target string
	port   int
	ln     net.Listener
	dial   dialFunc
	touch  func()
	logf   func(string, ...any)
	active atomic.Int32

	mu     sync.Mutex
	conns  map[net.Conn]struct{}
	closed bool
}

// listenForward listens on 127.0.0.1, on preferredPort when it is free.
func listenForward(target string, preferredPort int, dial dialFunc, touch func(), logf func(string, ...any)) (*forward, error) {
	var ln net.Listener
	var err error
	if preferredPort > 0 {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", preferredPort))
	}
	if ln == nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return nil, err
	}
	f := serveForward(target, ln.Addr().(*net.TCPAddr).Port, ln, dial, touch, logf)
	return f, nil
}

func serveForward(target string, port int, ln net.Listener, dial dialFunc, touch func(), logf func(string, ...any)) *forward {
	f := &forward{target: target, port: port, ln: ln, dial: dial, touch: touch, logf: logf, conns: map[net.Conn]struct{}{}}
	go f.serve()
	logf("engine: forwarding %s to %s", ln.Addr(), target)
	return f
}

func (f *forward) serve() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				f.logf("engine: forward %s stopped accepting: %v", f.target, err)
			}
			return
		}
		go f.handle(conn)
	}
}

func (f *forward) handle(local net.Conn) {
	f.active.Add(1)
	f.touch()
	defer func() {
		f.active.Add(-1)
		f.touch()
	}()
	if !f.track(local) {
		_ = local.Close()
		return
	}
	defer f.untrack(local)

	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	remote, err := f.dial(ctx, "tcp", f.target)
	cancel()
	if err != nil {
		f.logf("engine: dial %s: %v", f.target, err)
		_ = local.Close()
		return
	}
	if !f.track(remote) {
		_ = local.Close()
		_ = remote.Close()
		return
	}
	defer f.untrack(remote)

	done := make(chan struct{}, 2)
	pipe := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		// Pass the half-close on, so request/response protocols finish.
		if cw, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = cw.CloseWrite()
		} else {
			_ = dst.Close()
		}
		done <- struct{}{}
	}
	go pipe(remote, local)
	go pipe(local, remote)
	<-done
	<-done
	_ = local.Close()
	_ = remote.Close()
}

func (f *forward) track(c net.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.conns[c] = struct{}{}
	return true
}

func (f *forward) untrack(c net.Conn) {
	f.mu.Lock()
	delete(f.conns, c)
	f.mu.Unlock()
}

// close stops listening and drops every open connection, so clients notice
// at once instead of waiting on a dead node.
func (f *forward) close() {
	f.mu.Lock()
	f.closed = true
	conns := f.conns
	f.conns = map[net.Conn]struct{}{}
	f.mu.Unlock()
	_ = f.ln.Close()
	for c := range conns {
		_ = c.Close()
	}
}
