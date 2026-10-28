package engine

import (
	"bufio"
	"context"
	"fmt"
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
	f, err := listenForward(echoServer(t), 0, plainDial, e.touch, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	e.share = &phoneShare{forward: f}
	if !e.busy() {
		t.Fatal("sharing must prevent the idle timeout even without clients")
	}
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", f.port))
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
	if _, err := c.Read(make([]byte, 1)); err == nil {
		t.Fatal("connection remained open after sharing stopped")
	}
	e.StopPhoneShare()
}

func TestPhoneShareRequiresRunningTailnet(t *testing.T) {
	e := New(NewRing(50))
	if err := e.StartPhoneShare(); err != ErrStopped {
		t.Fatalf("got %v, want ErrStopped", err)
	}
}
