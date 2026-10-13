package engine

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"tailscale.com/net/netmon"
)

// Ring keeps the latest log lines in memory, for the app's diagnostics view.
type Ring struct {
	mu    sync.Mutex
	lines []string
	next  int
	full  bool
}

// NewRing keeps up to size lines.
func NewRing(size int) *Ring { return &Ring{lines: make([]string, size)} }

// Logf records one line.
func (r *Ring) Logf(format string, args ...any) {
	line := time.Now().Format("15:04:05 ") + strings.TrimRight(fmt.Sprintf(format, args...), "\n")
	r.mu.Lock()
	r.lines[r.next] = line
	r.next = (r.next + 1) % len(r.lines)
	if r.next == 0 {
		r.full = true
	}
	r.mu.Unlock()
}

// Lines returns the kept lines, oldest first.
func (r *Ring) Lines() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.full {
		return append([]string(nil), r.lines[:r.next]...)
	}
	return append(append([]string(nil), r.lines[r.next:]...), r.lines[:r.next]...)
}

// InterfaceInfo is one network interface as Android reports it. Android 11
// and later forbid the netlink queries Go uses to list interfaces, so the
// app supplies the list instead.
type InterfaceInfo struct {
	Name         string   `json:"name"`
	Index        int      `json:"index"`
	MTU          int      `json:"mtu"`
	Up           bool     `json:"up"`
	Broadcast    bool     `json:"broadcast"`
	Loopback     bool     `json:"loopback"`
	PointToPoint bool     `json:"pointToPoint"`
	Multicast    bool     `json:"multicast"`
	Addrs        []string `json:"addrs"` // CIDR, e.g. 192.168.1.20/24
}

var (
	interfaces     atomic.Pointer[[]netmon.Interface]
	registerGetter sync.Once
)

// SetInterfaces replaces the interface list the node sees. Call it before
// the first Start and again whenever the phone's networks change.
func SetInterfaces(list []InterfaceInfo) {
	converted := make([]netmon.Interface, 0, len(list))
	for _, info := range list {
		converted = append(converted, convertInterface(info))
	}
	interfaces.Store(&converted)
	registerGetter.Do(func() {
		netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
			return *interfaces.Load(), nil
		})
	})
}

func convertInterface(info InterfaceInfo) netmon.Interface {
	var flags net.Flags
	if info.Up {
		flags |= net.FlagUp | net.FlagRunning
	}
	if info.Broadcast {
		flags |= net.FlagBroadcast
	}
	if info.Loopback {
		flags |= net.FlagLoopback
	}
	if info.PointToPoint {
		flags |= net.FlagPointToPoint
	}
	if info.Multicast {
		flags |= net.FlagMulticast
	}
	addrs := make([]net.Addr, 0, len(info.Addrs))
	for _, cidr := range info.Addrs {
		// Drop an IPv6 zone such as fe80::1%wlan0/64.
		if i := strings.IndexByte(cidr, '%'); i >= 0 {
			if j := strings.IndexByte(cidr[i:], '/'); j >= 0 {
				cidr = cidr[:i] + cidr[i+j:]
			} else {
				cidr = cidr[:i]
			}
		}
		ip, prefix, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		addrs = append(addrs, &net.IPNet{IP: ip, Mask: prefix.Mask})
	}
	return netmon.Interface{
		Interface: &net.Interface{Index: info.Index, MTU: info.MTU, Name: info.Name, Flags: flags},
		AltAddrs:  addrs,
	}
}
