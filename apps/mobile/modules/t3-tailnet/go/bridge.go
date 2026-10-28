// Command t3tailnet builds libt3tailnet.so, the embedded Tailscale engine of
// the T3 Android app. Kotlin calls it through one JNI entry point that takes a
// method name and JSON arguments and returns JSON.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"t3tailnet/engine"
)

var (
	logs = engine.NewRing(400)
	eng  = engine.New(logs)
)

type startArgs struct {
	StateDir           string                 `json:"stateDir"`
	Hostname           string                 `json:"hostname"`
	IdleTimeoutSeconds int                    `json:"idleTimeoutSeconds"`
	Interfaces         []engine.InterfaceInfo `json:"interfaces"`
	DefaultInterface   string                 `json:"defaultInterface"`
}

// dispatch runs one call and returns {"ok":true,"result":...} or
// {"ok":false,"error":"..."}.
func dispatch(method, args string) string {
	result, err := run(method, []byte(args))
	if err != nil {
		return asciiJSON(map[string]any{"ok": false, "error": err.Error()})
	}
	return asciiJSON(map[string]any{"ok": true, "result": result})
}

func run(method string, args []byte) (any, error) {
	if len(args) == 0 {
		args = []byte("{}")
	}
	switch method {
	case "start":
		var a startArgs
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		if a.Interfaces != nil {
			engine.SetInterfaces(a.Interfaces)
			engine.SetDefaultInterface(a.DefaultInterface)
		}
		if err := eng.Start(engine.Config{
			StateDir:    a.StateDir,
			Hostname:    a.Hostname,
			IdleTimeout: time.Duration(a.IdleTimeoutSeconds) * time.Second,
		}); err != nil {
			return nil, err
		}
		return status(), nil
	case "interfaces":
		var a struct {
			Interfaces       []engine.InterfaceInfo `json:"interfaces"`
			DefaultInterface string                 `json:"defaultInterface"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		engine.SetInterfaces(a.Interfaces)
		engine.SetDefaultInterface(a.DefaultInterface)
		return struct{}{}, nil
	case "status":
		return status(), nil
	case "waitReady":
		var a struct {
			TimeoutMs int `json:"timeoutMs"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(a.TimeoutMs)*time.Millisecond)
		defer cancel()
		return eng.WaitReady(ctx), nil
	case "forward":
		var a struct {
			Target string `json:"target"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		port, err := eng.Forward(a.Target)
		if err != nil {
			return nil, err
		}
		return map[string]int{"port": port}, nil
	case "startPhoneShare":
		if err := eng.StartPhoneShare(); err != nil {
			return nil, err
		}
		return status(), nil
	case "stopPhoneShare":
		eng.StopPhoneShare()
		return status(), nil
	case "setIdleTimeout":
		var a struct {
			Seconds int `json:"seconds"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return nil, err
		}
		eng.SetIdleTimeout(time.Duration(a.Seconds) * time.Second)
		return status(), nil
	case "stop":
		eng.Stop("requested")
		return status(), nil
	case "logout":
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := eng.Logout(ctx); err != nil && err != engine.ErrStopped {
			logs.Logf("engine: sign-out: %v", err)
		}
		return status(), nil
	case "logs":
		return map[string][]string{"lines": logs.Lines()}, nil
	default:
		return nil, fmt.Errorf("unknown method %q", method)
	}
}

func main() {}

func status() engine.Status {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return eng.Status(ctx)
}

// asciiJSON escapes every non-ASCII character, because JNI's NewStringUTF
// takes modified UTF-8, which differs from UTF-8 above U+FFFF.
func asciiJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		raw, _ = json.Marshal(map[string]any{"ok": false, "error": err.Error()})
	}
	var b strings.Builder
	b.Grow(len(raw))
	for len(raw) > 0 {
		r, size := utf8.DecodeRune(raw)
		raw = raw[size:]
		switch {
		case r < utf8.RuneSelf:
			b.WriteRune(r)
		case r > 0xFFFF:
			r -= 0x10000
			fmt.Fprintf(&b, `\u%04x\u%04x`, 0xD800+(r>>10), 0xDC00+(r&0x3FF))
		default:
			fmt.Fprintf(&b, `\u%04x`, r)
		}
	}
	return b.String()
}
