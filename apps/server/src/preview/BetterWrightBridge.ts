// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Owns the external viewer process and WebSocket outside Effect.
import * as NodeChildProcess from "node:child_process";
import type { ServerBrowserViewerOutput } from "./ServerBrowser.ts";

export interface BetterWrightTarget {
  readonly session: string;
  readonly pageId: string;
  readonly profile?: string | undefined;
}

export interface BetterWrightProcess {
  readonly url: string;
  readonly closed: Promise<void>;
  readonly stop: () => Promise<void>;
}

export class BetterWrightCleanupError extends Error {
  readonly processId: number | undefined;
  readonly closed: Promise<void>;

  constructor(processId: number | undefined, closed: Promise<void>) {
    super("BetterWright viewer startup cleanup failed; inspect its process before another handoff.");
    this.processId = processId;
    this.closed = closed;
  }
}

export function betterWrightCommand(
  value: string | undefined,
  name = "T3CODE_BETTERWRIGHT_VIEW_COMMAND",
): ReadonlyArray<string> {
  if (!value)
    throw new Error(`Set ${name} to the host's existing-only sidecar command (a JSON array).`);
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((part) => typeof part === "string" && part.length > 0)
  ) {
    throw new Error(`${name} must be a nonempty JSON array of command arguments.`);
  }
  return parsed;
}

export function betterWrightSocketUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(url.searchParams.get("t") ?? "")
  ) {
    throw new Error("BetterWright must return a private IPv4 loopback viewer URL.");
  }
  url.protocol = "ws:";
  url.pathname = "/ws";
  return url.href;
}

const stopProcess = (child: NodeChildProcess.ChildProcess, exited: Promise<void>) => async () => {
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0)
      throw new Error("BetterWright viewer exited without verified cleanup.");
    return;
  }
  child.kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("BetterWright viewer did not stop gracefully; inspect the host process."),
            ),
          10_000,
        );
      }),
    ]);
    if (child.exitCode !== 0)
      throw new Error("BetterWright viewer shutdown failed; inspect the host process.");
  } finally {
    clearTimeout(timer);
  }
};

export async function startBetterWrightViewer(
  command: ReadonlyArray<string>,
  target: BetterWrightTarget,
  signal: AbortSignal,
): Promise<BetterWrightProcess> {
  const child = NodeChildProcess.spawn(
    command[0]!,
    [
      ...command.slice(1),
      "--session",
      target.session,
      ...(target.profile ? ["--profile", target.profile] : []),
      "--port",
      "0",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        BETTERWRIGHT_LIVE_VIEW_HOST: "127.0.0.1",
        BETTERWRIGHT_LIVE_VIEW_PUBLIC_HOST: "127.0.0.1",
        BETTERWRIGHT_LIVE_VIEW_EXPOSE: "local",
      },
    },
  );
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const stop = stopProcess(child, exited);
  const ready = Promise.withResolvers<string>();
  let buffer = "";
  const read = (chunk: Buffer) => {
    buffer = (buffer + chunk.toString()).replace(/\u001b\[[0-9;]*m/g, "");
    if (buffer.length > 65_536) {
      ready.reject(new Error("BetterWright viewer output exceeded its startup limit."));
      return;
    }
    for (const line of buffer.split(/\r?\n/).slice(0, -1)) {
      const match = /^(?:Live view:\s*)?(http:\/\/\S+)\s*$/.exec(line.trim());
      if (match) {
        try {
          betterWrightSocketUrl(match[1]!);
          ready.resolve(match[1]!);
        } catch {
          ready.reject(new Error("BetterWright returned an unsafe viewer endpoint."));
        }
      }
    }
  };
  child.stdout.on("data", read);
  // Never include CLI output in an error: it can contain the viewer capability.
  child.stderr.on("data", () => undefined);
  child.once("error", () =>
    ready.reject(new Error("The configured BetterWright viewer could not start.")),
  );
  child.once("exit", () => ready.reject(new Error("BetterWright viewer exited before handoff.")));
  const abort = () => ready.reject(new Error("Browser handoff was cancelled."));
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => ready.reject(new Error("BetterWright viewer did not become ready.")),
    25_000,
  );
  try {
    signal.throwIfAborted();
    return { url: await ready.promise, stop, closed: exited };
  } catch (error) {
    try {
      await stop();
    } catch {
      throw new BetterWrightCleanupError(child.pid, exited);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    child.stdout.off("data", read);
    child.stdout.resume();
  }
}

type Output =
  | Exclude<ServerBrowserViewerOutput, { readonly _tag: "frame" }>
  | { readonly _tag: "frame"; readonly data: Uint8Array };
type Viewer = { readonly canOperate: boolean; readonly push: (value: Output) => void };
type Outcome = "completed" | "cancelled" | "timed-out";
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
const finite = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export class BetterWrightBridge {
  private readonly socket: WebSocket;
  private readonly target: BetterWrightTarget;
  private readonly viewers = new Map<string, Viewer>();
  private readonly ready = Promise.withResolvers<void>();
  private readonly finished = Promise.withResolvers<Outcome>();
  private owner: string | null = null;
  private generation = 0;
  private selected = false;
  private bound = false;
  private ended = false;
  private width = 1280;
  private height = 800;
  private frame: Uint8Array | undefined;
  private pageId: string | undefined;
  private readonly keys = new Map<string, Record<string, unknown>>();
  private readonly buttons = new Map<string, Record<string, unknown>>();
  private readonly update: (url: string, title: string) => void;
  private readonly probe: (x: number, y: number) => Promise<boolean>;
  private probeGeneration = 0;

  constructor(
    url: string,
    target: BetterWrightTarget,
    update: (url: string, title: string) => void,
    makeSocket: (url: string) => WebSocket = (value) => new WebSocket(value),
    probe: (x: number, y: number) => Promise<boolean> = () => Promise.resolve(false),
  ) {
    this.target = target;
    this.update = update;
    this.probe = probe;
    this.socket = makeSocket(betterWrightSocketUrl(url));
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("error", () => this.fail());
    this.socket.addEventListener("close", () => this.fail());
    this.socket.addEventListener("message", (event) => this.receive(event.data));
  }

  waitUntilReady() {
    return this.ready.promise;
  }
  waitUntilFinished() {
    return this.finished.promise;
  }

  private send(value: unknown) {
    if (!this.ended && this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(value));
  }

  private control(viewer: Viewer, id: string): Output {
    return {
      _tag: "control",
      canOperate: viewer.canOperate && !this.ended,
      controller: this.owner === id ? "you" : this.owner ? "another-viewer" : "agent",
      generation: this.generation,
      dialog: null,
    };
  }

  private broadcastControl() {
    for (const [id, viewer] of this.viewers) viewer.push(this.control(viewer, id));
  }

  private broadcast(output: Output) {
    for (const viewer of this.viewers.values()) viewer.push(output);
  }

  private fail() {
    this.ready.reject(
      new Error("The BetterWright viewer could not attach to the requested existing page."),
    );
    this.finish("cancelled");
  }

  private receive(data: unknown) {
    if (this.ended) return;
    if (data instanceof ArrayBuffer) {
      if (this.pageId !== this.target.pageId || data.byteLength > 8 * 1024 * 1024) return;
      this.frame = new Uint8Array(data);
      if (this.bound) this.broadcast({ _tag: "frame", data: this.frame });
      return;
    }
    if (typeof data !== "string") return;
    let message: Record<string, unknown> | undefined;
    try {
      message = record(JSON.parse(data));
    } catch {
      return;
    }
    if (!message) return;
    if ((message.t === "hello" || message.t === "state") && message.interactive !== true)
      return this.fail();
    if (message.t === "bye") return this.fail();
    if (message.t === "tabs" && Array.isArray(message.tabs)) {
      const tabs = message.tabs.map(record);
      const target = tabs.find(
        (tab) => tab?.sessionId === this.target.session && tab.id === this.target.pageId,
      );
      if (!target) return this.fail();
      if (target.streaming !== true) {
        if (this.bound) return this.fail();
        if (this.selected) return;
        this.selected = true;
        this.send({ t: "tab", id: this.target.pageId });
        return;
      }
      this.bound = true;
      this.ready.resolve();
      this.send({ t: "vis", hidden: false });
      this.broadcast({ _tag: "viewport", width: this.width, height: this.height });
      if (this.frame) this.broadcast({ _tag: "frame", data: this.frame });
      if (typeof target.url === "string" && /^https?:\/\//.test(target.url)) {
        this.update(
          target.url,
          typeof target.title === "string" ? target.title : "Browser handoff",
        );
      }
    }
    if (message.t === "meta") {
      this.pageId = typeof message.pageId === "string" ? message.pageId : undefined;
      if (message.pageId !== this.target.pageId) {
        this.frame = undefined;
        if (this.bound) return this.fail();
        return;
      }
      this.width = Math.max(1, finite(message.deviceWidth, this.width));
      this.height = Math.max(1, finite(message.deviceHeight, this.height));
      if (this.bound) this.broadcast({ _tag: "viewport", width: this.width, height: this.height });
    }
  }

  attach(id: string, viewer: Viewer) {
    this.viewers.set(id, viewer);
    viewer.push({ _tag: "viewport", width: this.width, height: this.height });
    viewer.push(this.control(viewer, id));
    if (this.frame) viewer.push({ _tag: "frame", data: this.frame });
    if (this.ended) viewer.push({ _tag: "gone" });
    return () => {
      this.viewers.delete(id);
      if (this.owner === id) {
        this.releasePressedInput();
        this.owner = null;
        this.generation++;
        this.broadcastControl();
      }
    };
  }

  input(id: string, raw: unknown) {
    const viewer = this.viewers.get(id);
    const message = record(raw);
    if (!viewer?.canOperate || !message || this.ended || !this.bound) return;
    if (message.type === "takeControl") {
      if (this.owner !== null && this.owner !== id) return;
      this.owner = id;
      this.generation++;
      this.broadcastControl();
      return;
    }
    if (this.owner !== id) return;
    if (message.type === "releaseControl") {
      this.finish("completed");
      return;
    }
    const modifiers = Math.max(0, Math.min(15, finite(message.modifiers)));
    const x = Math.max(0, Math.min(this.width, finite(message.x)));
    const y = Math.max(0, Math.min(this.height, finite(message.y)));
    switch (message.type) {
      case "mouse":
        this.send({
          t: "input",
          kind: "mouse",
          type:
            message.action === "down"
              ? "mousePressed"
              : message.action === "up"
                ? "mouseReleased"
                : "mouseMoved",
          x,
          y,
          button: message.button,
          buttons: finite(message.buttons),
          clickCount: finite(message.clickCount, 1),
          modifiers,
        });
        if (typeof message.button === "string") {
          if (message.action === "down")
            this.buttons.set(message.button, { x, y, button: message.button });
          if (message.action === "up") this.buttons.delete(message.button);
        }
        break;
      case "wheel":
        this.send({
          t: "input",
          kind: "mouse",
          type: "mouseWheel",
          x,
          y,
          deltaX: finite(message.deltaX),
          deltaY: finite(message.deltaY),
          modifiers,
        });
        break;
      case "key":
        this.send({
          t: "input",
          kind: "key",
          type: message.action === "up" ? "keyUp" : message.text ? "keyDown" : "rawKeyDown",
          key: message.key,
          code: message.code,
          keyCode: message.keyCode,
          text: message.text,
          modifiers,
        });
        if (typeof message.key === "string") {
          if (message.action === "up") this.keys.delete(String(message.code || message.key));
          else
            this.keys.set(String(message.code || message.key), {
              key: message.key,
              code: message.code,
              keyCode: message.keyCode,
            });
        }
        break;
      case "text":
        if (typeof message.text === "string")
          this.send({ t: "input", kind: "insertText", text: message.text.slice(0, 8192) });
        break;
      case "resize":
        this.send({
          t: "view",
          px: Math.min(3840, Math.max(finite(message.width), finite(message.height))),
        });
        break;
      case "reload":
        this.send({ t: "nav", action: "reload" });
        break;
      case "history":
        this.send({ t: "nav", action: message.delta === -1 ? "back" : "forward" });
        break;
      case "navigate":
        if (typeof message.url === "string" && /^https?:\/\//.test(message.url))
          this.send({ t: "navigate", url: message.url });
        break;
      case "probe": {
        const generation = ++this.probeGeneration;
        void this.probe(x, y)
          .catch(() => false)
          .then((editable) => {
            if (!this.ended && this.owner === id && this.probeGeneration === generation)
              viewer.push({ _tag: "probe", x, y, editable });
          });
        break;
      }
    }
  }

  private releasePressedInput() {
    for (const key of this.keys.values())
      this.send({ t: "input", kind: "key", type: "keyUp", ...key });
    for (const button of this.buttons.values())
      this.send({ t: "input", kind: "mouse", type: "mouseReleased", buttons: 0, ...button });
    this.keys.clear();
    this.buttons.clear();
  }

  finish(outcome: Outcome) {
    if (this.ended) return;
    this.releasePressedInput();
    this.ended = true;
    this.owner = null;
    this.generation++;
    this.broadcastControl();
    this.broadcast({ _tag: "gone" });
    this.finished.resolve(outcome);
    this.socket.close();
  }
}
