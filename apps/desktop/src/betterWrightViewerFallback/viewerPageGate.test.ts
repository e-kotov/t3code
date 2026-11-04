import { describe, expect, it } from "vite-plus/test";

import { ViewerPageGate } from "./viewerPageGate.ts";

const TARGET = "page-target";
const json = (value: unknown) => JSON.stringify(value);
const frame = (byte: number) => new Uint8Array([byte, byte]);
const input = json({ t: "input", kind: "insertText", text: "secret answer" });
const reselect = json({ t: "tab", id: TARGET });

describe("viewer page gate", () => {
  it("shows nothing and forwards no operation until the handoff page is confirmed on join", () => {
    const gate = new ViewerPageGate(TARGET);
    // BetterWright 1.10.2 handleConnection: hello, cached frame and other tabs' thumbs, then
    // ensureStreaming() moves to the agent's preferred page and only then broadcasts meta.
    expect(
      gate.fromViewer(
        json({
          t: "hello",
          agent: "driving",
          interactive: true,
          handoff: { prompt: "other agent" },
        }),
      ),
    ).toEqual({
      toWindow: json({ t: "hello", agent: "driving", interactive: true, caps: { newTab: false } }),
      toViewer: null,
    });
    expect(gate.fromViewer(frame(7)).toWindow).toBeNull();
    expect(gate.fromViewer(json({ t: "thumb", id: "other", thumb: "data:x" })).toWindow).toBeNull();
    expect(
      gate.fromViewer(json({ t: "chat", messages: ["other agent chat"] })).toWindow,
    ).toBeNull();
    expect(gate.fromWindow(input)).toBeNull();
    expect(gate.fromViewer(json({ t: "meta", pageId: "preferred", url: "https://other" }))).toEqual(
      {
        toWindow: null,
        toViewer: reselect,
      },
    );
    expect(gate.fromViewer(frame(7)).toWindow).toBeNull();
    expect(gate.fromViewer(json({ t: "navstate", canGoBack: true })).toWindow).toBeNull();
    expect(gate.fromWindow(input)).toBeNull();
    expect(gate.fromWindow(json({ t: "nav", action: "back" }))).toBeNull();
    // A tab list naming other pages reveals only the handoff page.
    expect(
      gate.fromViewer(
        json({
          t: "tabs",
          tabs: [
            { id: "preferred", title: "Other mail", streaming: true },
            { id: TARGET, title: "Login", streaming: false },
          ],
        }),
      ),
    ).toEqual({
      toWindow: json({ t: "tabs", tabs: [{ id: TARGET, title: "Login", streaming: false }] }),
      toViewer: reselect,
    });
    expect(gate.isConfirmed).toBe(false);

    const confirmed = gate.fromViewer(
      json({
        t: "meta",
        pageId: TARGET,
        url: "https://login",
        deviceWidth: 800,
        deviceHeight: 600,
      }),
    );
    expect(JSON.parse(String(confirmed.toWindow))).toMatchObject({ t: "meta", pageId: TARGET });
    expect(gate.fromViewer(frame(9)).toWindow).toEqual(frame(9));
    expect(gate.fromWindow(input)).toBe(input);
  });

  it("closes again on any sign of another page and bounds its reselect requests", () => {
    const gate = new ViewerPageGate(TARGET);
    gate.fromViewer(json({ t: "meta", pageId: TARGET }));
    expect(gate.isConfirmed).toBe(true);
    // Another client joins and BetterWright moves to its preferred page.
    gate.fromViewer(json({ t: "meta", pageId: "preferred" }));
    expect(gate.fromViewer(frame(3)).toWindow).toBeNull();
    expect(gate.fromWindow(input)).toBeNull();
    gate.fromViewer(json({ t: "meta", pageId: TARGET }));
    gate.fromViewer(json({ t: "tabs", tabs: [{ id: TARGET, streaming: false }] }));
    expect(gate.fromWindow(input)).toBeNull();
    gate.fromViewer(json({ t: "meta", pageId: TARGET }));
    gate.fromViewer(json({ t: "tabs", tabs: [{ id: "preferred", streaming: true }] }));
    expect(gate.fromViewer(frame(3)).toWindow).toBeNull();

    // A repoint that never lands asks five times, then stays closed.
    const stuck = new ViewerPageGate(TARGET);
    const requests = Array.from(
      { length: 8 },
      () => stuck.fromViewer(json({ t: "meta", pageId: "preferred" })).toViewer,
    );
    expect(requests.filter((request) => request === reselect)).toHaveLength(5);
    expect(stuck.fromViewer(frame(1)).toWindow).toBeNull();
  });

  it("drops page-changing and unknown messages from the window even when confirmed", () => {
    const gate = new ViewerPageGate(TARGET);
    gate.fromViewer(json({ t: "meta", pageId: TARGET }));
    for (const message of [
      { t: "tab", id: "other" },
      { t: "newtab", url: "https://example.com" },
      { t: "closetab", id: TARGET },
      { t: "navigate", url: "file:///etc/passwd" },
      { t: "done" },
      { t: "cancel" },
      { t: "chat", text: "to another agent" },
      { t: "unknown" },
    ])
      expect(gate.fromWindow(json(message)), message.t).toBeNull();
    expect(gate.fromWindow("not json")).toBeNull();
    expect(gate.fromWindow(frame(1))).toBeNull();
    expect(gate.fromWindow(reselect)).toBe(reselect);
    const navigate = json({ t: "navigate", url: "https://example.com/login" });
    expect(gate.fromWindow(navigate)).toBe(navigate);
    expect(gate.fromWindow(json({ t: "vis", hidden: false }))).not.toBeNull();
    expect(gate.fromViewer("{bad json").toWindow).toBeNull();
    expect(gate.fromViewer(json({ t: "mystery", payload: 1 })).toWindow).toBeNull();
  });
});
