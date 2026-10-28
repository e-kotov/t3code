package engine

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
	"time"
)

func TestPhoneShareForwardsOnlyToPhoneT3(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	target := echoServer(t)
	requested := make(chan string, 1)
	s := newPhoneShare(ln, func(ctx context.Context, network, address string) (net.Conn, error) {
		requested <- address
		return plainDial(ctx, network, target)
	}, func() {}, t.Logf)
	defer s.close()
	c, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprint(c, "hello\n")
	if line, err := bufio.NewReader(c).ReadString('\n'); err != nil || line != "echo hello\n" {
		t.Fatalf("response = %q, %v", line, err)
	}
	if address := <-requested; address != "127.0.0.1:3774" {
		t.Fatalf("forwarded to %s, want phone T3 loopback", address)
	}
}

func TestPhoneShareStopClosesActiveConnectionAndAllowsIdle(t *testing.T) {
	e := New(NewRing(50))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	target := echoServer(t)
	e.share = newPhoneShare(ln, func(ctx context.Context, network, address string) (net.Conn, error) {
		return plainDial(ctx, network, target)
	}, e.touch, t.Logf)
	if !e.busy() {
		t.Fatal("sharing must prevent the idle timeout even without clients")
	}
	c, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprint(c, "hello\n")
	if _, err := bufio.NewReader(c).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	e.StopPhoneShare()
	if e.busy() {
		t.Fatal("stopped sharing must permit the node to idle")
	}
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Read(make([]byte, 1)); !errors.Is(err, io.EOF) {
		t.Fatalf("read after sharing stopped = %v, want EOF", err)
	}
	e.StopPhoneShare()
}

func TestSharingSurvivesSignInTimeoutWithoutClients(t *testing.T) {
	e := New(NewRing(50))
	e.idleTimeout.Store(int64(5 * time.Minute))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	e.share = newPhoneShare(ln, plainDial, e.touch, t.Logf)
	defer e.StopPhoneShare()
	if reason := e.idleStopReason(11*time.Minute, func() bool {
		t.Fatal("active sharing must not depend on a transient backend status")
		return false
	}); reason != "" {
		t.Fatalf("active share stopped: %s", reason)
	}
	e.StopPhoneShare()
	if reason := e.idleStopReason(11*time.Minute, func() bool { return false }); reason != "sign-in not completed" {
		t.Fatalf("abandoned sign-in stop reason = %q", reason)
	}
}

func TestPhoneShareRequiresRunningTailnet(t *testing.T) {
	e := New(NewRing(50))
	if err := e.StartPhoneShare(); err != ErrStopped {
		t.Fatalf("got %v, want ErrStopped", err)
	}
}
