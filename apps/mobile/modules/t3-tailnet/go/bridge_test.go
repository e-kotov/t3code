package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestASCIIJSONEscapesForModifiedUTF8(t *testing.T) {
	out := asciiJSON(map[string]string{"name": "café 🙂"})
	for _, r := range out {
		if r > 0x7F {
			t.Fatalf("non-ASCII in %q", out)
		}
	}
	var back map[string]string
	if err := json.Unmarshal([]byte(out), &back); err != nil || back["name"] != "café 🙂" {
		t.Fatalf("round trip = %v, %v", back, err)
	}
}

func TestDispatchReportsErrors(t *testing.T) {
	if out := dispatch("nope", ""); !strings.Contains(out, `"ok":false`) {
		t.Fatalf("unknown method: %s", out)
	}
	if out := dispatch("forward", `{"target":"100.64.0.1:80"}`); !strings.Contains(out, "not running") {
		t.Fatalf("forward while stopped: %s", out)
	}
	if out := dispatch("status", ""); !strings.Contains(out, `"state":"stopped"`) {
		t.Fatalf("status while stopped: %s", out)
	}
	if out := dispatch("startPhoneShare", ""); !strings.Contains(out, "not running") {
		t.Fatalf("share while stopped: %s", out)
	}
}
