//go:build android

package engine

import "tailscale.com/net/netmon"

// SetDefaultInterface records the interface Android routes through; ""
// means no network. Go cannot read the routing table on Android.
func SetDefaultInterface(name string) { netmon.UpdateLastKnownDefaultRouteInterface(name) }
