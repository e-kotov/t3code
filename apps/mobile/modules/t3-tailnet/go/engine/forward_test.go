package engine

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"testing"
	"time"
)

func echoServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				r := bufio.NewReader(c)
				for {
					line, err := r.ReadString('\n')
					if err != nil {
						return
					}
					fmt.Fprint(c, "echo "+line)
				}
			}()
		}
	}()
	return ln.Addr().String()
}

func plainDial(ctx context.Context, network, address string) (net.Conn, error) {
	var d net.Dialer
	return d.DialContext(ctx, network, address)
}

func TestForwardCopiesBothWaysAndCountsConnections(t *testing.T) {
	target := echoServer(t)
	f, err := listenForward(target, 0, plainDial, func() {}, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	defer f.close()

	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", f.port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprint(c, "hi\n")
	line, err := bufio.NewReader(c).ReadString('\n')
	if err != nil || line != "echo hi\n" {
		t.Fatalf("got %q, %v", line, err)
	}
	if got := f.active.Load(); got != 1 {
		t.Fatalf("active = %d, want 1", got)
	}
}

func TestForwardCloseDropsOpenConnections(t *testing.T) {
	f, err := listenForward(echoServer(t), 0, plainDial, func() {}, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", f.port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	fmt.Fprint(c, "hi\n")
	if _, err := bufio.NewReader(c).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	f.close()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Read(make([]byte, 1)); err == nil {
		t.Fatal("connection still open after close")
	}
}

func TestForwardReusesPreferredPort(t *testing.T) {
	target := echoServer(t)
	first, err := listenForward(target, 0, plainDial, func() {}, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	port := first.port
	first.close()
	second, err := listenForward(target, port, plainDial, func() {}, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	defer second.close()
	if second.port != port {
		t.Fatalf("port = %d, want %d", second.port, port)
	}
}

func TestForwardFailedDialClosesClient(t *testing.T) {
	refuse := func(context.Context, string, string) (net.Conn, error) {
		return nil, fmt.Errorf("no route")
	}
	f, err := listenForward("100.64.0.1:1", 0, refuse, func() {}, t.Logf)
	if err != nil {
		t.Fatal(err)
	}
	defer f.close()
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", f.port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Read(make([]byte, 1)); err == nil {
		t.Fatal("client stayed open after a failed dial")
	}
}

func TestConvertInterfaceDropsZoneAndSetsFlags(t *testing.T) {
	got := convertInterface(InterfaceInfo{
		Name: "wlan0", Index: 3, MTU: 1500, Up: true, Multicast: true,
		Addrs: []string{"192.168.1.20/24", "fe80::1%wlan0/64", "garbage"},
	})
	if got.Flags&net.FlagUp == 0 || got.Flags&net.FlagMulticast == 0 || got.Flags&net.FlagLoopback != 0 {
		t.Fatalf("flags = %v", got.Flags)
	}
	if len(got.AltAddrs) != 2 || got.AltAddrs[1].String() != "fe80::1/64" {
		t.Fatalf("addrs = %v", got.AltAddrs)
	}
}
