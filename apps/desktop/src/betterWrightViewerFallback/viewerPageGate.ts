/**
 * Holds a viewer window to the handoff page over BetterWright 1.10.2's live-view protocol.
 * Frames carry no page id, so nothing reaches the window and no operation reaches the daemon
 * until `meta.pageId` confirms the page; unknown messages are dropped, drift reselects (bounded).
 */

const MAX_RESELECTS = 5;

export type ViewerData = string | Uint8Array;

export interface GateResult {
  readonly toWindow: ViewerData | null;
  readonly toViewer: string | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parse = (data: string) => {
  try {
    return record(JSON.parse(data));
  } catch {
    return null;
  }
};

const DROP: GateResult = { toWindow: null, toViewer: null };

// Messages that act on the page or the daemon, and that only reach it once the page is confirmed.
const PAGE_OPERATIONS = new Set(["input", "nav"]);
// Housekeeping the viewer page sends that never acts on a page.
const VIEWER_SETTINGS = new Set(["vis", "view", "refresh"]);

export class ViewerPageGate {
  private confirmed = false;
  private reselects = 0;

  constructor(private readonly pageId: string) {}

  get isConfirmed() {
    return this.confirmed;
  }

  private unconfirm(): GateResult {
    this.confirmed = false;
    if (this.reselects >= MAX_RESELECTS) return DROP;
    this.reselects++;
    return { toWindow: null, toViewer: JSON.stringify({ t: "tab", id: this.pageId }) };
  }

  /** A message from the daemon on its way to the window. */
  fromViewer(data: ViewerData): GateResult {
    if (typeof data !== "string") return this.confirmed ? { toWindow: data, toViewer: null } : DROP;
    const message = parse(data);
    if (message === null) return DROP;
    switch (message.t) {
      case "meta": {
        if (message.pageId !== this.pageId) return this.unconfirm();
        this.confirmed = true;
        this.reselects = 0;
        return {
          toWindow: JSON.stringify({
            t: "meta",
            pageId: this.pageId,
            url: typeof message.url === "string" ? message.url : "",
            deviceWidth: message.deviceWidth,
            deviceHeight: message.deviceHeight,
          }),
          toViewer: null,
        };
      }
      case "tabs": {
        const tabs = Array.isArray(message.tabs) ? message.tabs.map(record) : [];
        const target = tabs.find((tab) => tab?.id === this.pageId);
        if (!target) {
          this.confirmed = false;
          return DROP;
        }
        const shown = { toWindow: JSON.stringify({ t: "tabs", tabs: [target] }), toViewer: null };
        return target.streaming === true
          ? shown
          : { ...this.unconfirm(), toWindow: shown.toWindow };
      }
      case "thumb":
        return message.id === this.pageId ? { toWindow: data, toViewer: null } : DROP;
      case "navstate":
        return this.confirmed ? { toWindow: data, toViewer: null } : DROP;
      case "hello":
      case "state":
        // Without the daemon's own handoff or question state, which may belong to another agent.
        return {
          toWindow: JSON.stringify({
            t: message.t,
            agent: message.agent === "driving" ? "driving" : "idle",
            interactive: message.interactive === true,
            caps: { newTab: false },
          }),
          toViewer: null,
        };
      case "toast":
        return typeof message.text === "string"
          ? { toWindow: JSON.stringify({ t: "toast", text: message.text }), toViewer: null }
          : DROP;
      case "bye":
        return { toWindow: JSON.stringify({ t: "bye" }), toViewer: null };
      default:
        return DROP;
    }
  }

  /** A message from the window on its way to the daemon, or null when it must not go. */
  fromWindow(data: ViewerData): string | null {
    if (typeof data !== "string") return null;
    const message = parse(data);
    if (message === null || typeof message.t !== "string") return null;
    if (VIEWER_SETTINGS.has(message.t)) return data;
    if (message.t === "tab") return message.id === this.pageId ? data : null;
    if (!this.confirmed) return null;
    if (PAGE_OPERATIONS.has(message.t)) return data;
    if (message.t === "navigate")
      return typeof message.url === "string" && /^https?:\/\//.test(message.url) ? data : null;
    return null;
  }
}
