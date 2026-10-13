//go:build !android

package engine

// SetDefaultInterface only matters on Android, where Go cannot read the
// routing table.
func SetDefaultInterface(string) {}
