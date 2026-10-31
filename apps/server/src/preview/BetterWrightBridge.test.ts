// @effect-diagnostics nodeBuiltinImport:off - Exercises the real child-process lifecycle.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  betterWrightCommand,
  betterWrightSocketUrl,
  BetterWrightBridge,
  startBetterWrightViewer,
} from "./BetterWrightBridge.ts";

const target = { session: "research", pageId: "existing-page" };
const url = "http://127.0.0.1:18765/?t=private-test-token";

function setup() {
  const sent: Array<Record<string, unknown>> = [];
  class FakeSocket extends EventTarget {
    readyState: number = WebSocket.OPEN;
    binaryType = "arraybuffer";
    send(data: string) {
      sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = WebSocket.CLOSED;
    }
    receive(data: unknown) {
      this.dispatchEvent(
        new MessageEvent("message", {
          data:
            typeof data === "object" && !(data instanceof ArrayBuffer)
              ? JSON.stringify(data)
              : data,
        }),
      );
    }
  }
  const socket = new FakeSocket();
  const updates: string[] = [];
  const bridge = new BetterWrightBridge(
    url,
    target,
    (url) => updates.push(url),
    () => socket as unknown as WebSocket,
  );
  const select = () => {
    socket.receive({ t: "hello", interactive: true });
    socket.receive({ t: "meta", pageId: target.pageId, deviceWidth: 800, deviceHeight: 600 });
    socket.receive({
      t: "tabs",
      tabs: [
        {
          ...target,
          id: target.pageId,
          sessionId: target.session,
          streaming: true,
          url: "https://example.com",
        },
      ],
    });
  };
  return { bridge, socket, select, sent, updates };
}

describe("BetterWright handoff", () => {
  it("binds the exact existing page, suppresses foreign frames and preserves its first paint", async () => {
    const { bridge, socket, select, updates } = setup();
    const output: Array<{ readonly _tag: string }> = [];
    bridge.attach("phone", { canOperate: true, push: (value) => output.push(value) });
    socket.receive({ t: "meta", pageId: "unrelated-page" });
    socket.receive(new Uint8Array([1, 2, 3]).buffer);
    expect(output.some((value) => value._tag === "frame")).toBe(false);
    socket.receive({ t: "meta", pageId: target.pageId, deviceWidth: 800, deviceHeight: 600 });
    socket.receive(new Uint8Array([255, 216, 255, 217]).buffer);
    select();
    await bridge.waitUntilReady();
    expect(output.filter((value) => value._tag === "frame")).toHaveLength(1);
    expect(updates).toEqual(["https://example.com"]);
    socket.receive({ t: "meta", pageId: "unrelated-page" });
    expect(await bridge.waitUntilFinished()).toBe("cancelled");
  });

  it("refuses a missing or different-session page instead of opening a replacement", async () => {
    const { bridge, socket } = setup();
    const ready = expect(bridge.waitUntilReady()).rejects.toThrow("requested existing page");
    socket.receive({
      t: "tabs",
      tabs: [{ id: target.pageId, sessionId: "another-session", streaming: true }],
    });
    await ready;
    expect(await bridge.waitUntilFinished()).toBe("cancelled");
  });

  it("enforces read-only and single-human ownership, releases held inputs on disconnect, and resumes only on explicit release", async () => {
    const { bridge, select, sent } = setup();
    select();
    await bridge.waitUntilReady();
    const reader: unknown[] = [];
    bridge.attach("reader", { canOperate: false, push: (value) => reader.push(value) });
    bridge.input("reader", { type: "takeControl" });
    bridge.input("reader", { type: "text", text: "forbidden" });
    const detach = bridge.attach("phone", { canOperate: true, push: () => undefined });
    bridge.attach("other", { canOperate: true, push: () => undefined });
    bridge.input("phone", { type: "text", text: "before takeover" });
    bridge.input("phone", { type: "takeControl" });
    bridge.input("other", { type: "takeControl" });
    bridge.input("other", { type: "text", text: "wrong owner" });
    bridge.input("phone", { type: "key", action: "down", key: "Shift", code: "ShiftLeft" });
    bridge.input("phone", {
      type: "mouse",
      action: "down",
      button: "left",
      x: 50,
      y: 60,
      buttons: 1,
    });
    detach();
    expect(sent.filter((message) => message.kind === "insertText")).toEqual([]);
    expect(sent).toContainEqual(
      expect.objectContaining({ kind: "key", type: "keyUp", key: "Shift" }),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({ kind: "mouse", type: "mouseReleased", buttons: 0 }),
    );
    expect(reader).toContainEqual(
      expect.objectContaining({ controller: "another-viewer", canOperate: false }),
    );
    bridge.input("other", { type: "releaseControl" });
    bridge.input("other", { type: "takeControl" });
    bridge.input("other", { type: "text", text: "human input" });
    bridge.input("other", { type: "releaseControl" });
    expect(await bridge.waitUntilFinished()).toBe("completed");
    expect(sent.filter((message) => message.kind === "insertText")).toEqual([
      { t: "input", kind: "insertText", text: "human input" },
    ]);
  });

  it.each([
    "https://127.0.0.1:18765/?t=private-test-token",
    "http://100.64.0.1:18765/?t=private-test-token",
    "http://127.0.0.1:18765/",
    "http://user@127.0.0.1:18765/?t=private-test-token",
    "http://127.0.0.1:18765/other?t=private-test-token",
  ])("rejects an unsafe capability endpoint (%s)", (value) => {
    expect(() => betterWrightSocketUrl(value)).toThrow();
  });

  it("uses a literal argument vector and gracefully stops only its spawned viewer", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-handoff-"));
    try {
      const output = NodePath.join(root, "args.json");
      const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(1)));process.on('SIGTERM',()=>process.exit(0));process.stdout.write('Live view: http://127.0.0.1:18765/?t=private-test-token\\n');setInterval(()=>{},1000);`;
      const command = [process.execPath, "-e", script, "--"];
      const viewer = await startBetterWrightViewer(
        betterWrightCommand(JSON.stringify(command)),
        { ...target, profile: "tudo-publishers" },
        new AbortController().signal,
      );
      expect(viewer.url).toBe(url);
      await viewer.stop();
      expect(JSON.parse(await NodeFSP.readFile(output, "utf8"))).toEqual([
        "--session",
        "research",
        "--profile",
        "tudo-publishers",
        "--port",
        "0",
      ]);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("stops a failed startup without putting its capability URL in the error", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-handoff-failure-"));
    const marker = NodePath.join(root, "stopped");
    try {
      const script = `const fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});console.log('Live view: http://public.invalid:18765/?t=secret-capability-token');setInterval(()=>{},1000);`;
      await expect(startBetterWrightViewer([process.execPath, "-e", script, "--"], target, new AbortController().signal)).rejects.toThrow("unsafe viewer endpoint");
      expect(await NodeFSP.readFile(marker, "utf8")).toBe("stopped");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
