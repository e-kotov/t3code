import { isProtectedBrowserAsset } from "@t3tools/contracts";
import type { Browser, BrowserContext } from "playwright-core";

interface Message {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
  readonly params?: {
    readonly sessionId?: string;
    readonly message?: string;
    readonly requestId?: string;
    readonly request?: { readonly url: string };
  };
}

const targets = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: false,
  filter: [
    { type: "page" },
    { type: "iframe" },
    { type: "worker" },
    { type: "shared_worker" },
    { exclude: true },
  ],
};

// Playwright routing misses redirected requests; CDP Fetch pauses each hop before sending it.
class GuardSession {
  private nextId = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  private readonly children = new Map<string, GuardSession>();

  constructor(
    private readonly write: (message: string) => Promise<unknown>,
    private readonly fail: (cause: unknown) => void,
  ) {}

  private readonly failure = (cause: unknown) => {
    if (!this.disposed) this.fail(cause);
  };

  private send(method: string, params: object = {}) {
    const id = ++this.nextId;
    const pending = Promise.withResolvers<unknown>();
    this.pending.set(id, pending);
    void this.write(JSON.stringify({ id, method, params })).catch((cause) => {
      this.pending.delete(id);
      pending.reject(cause);
    });
    return pending.promise;
  }

  async protect() {
    await this.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    await this.send("Target.setAutoAttach", targets);
    await this.send("Runtime.runIfWaitingForDebugger");
  }

  receive(message: Message) {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
      return;
    }
    const params = message.params;
    if (message.method === "Target.attachedToTarget" && params?.sessionId) {
      const sessionId = params.sessionId;
      const child = new GuardSession(
        (payload) => this.send("Target.sendMessageToTarget", { sessionId, message: payload }),
        this.failure,
      );
      this.children.set(sessionId, child);
      void child.protect().catch(child.failure);
    } else if (
      message.method === "Target.receivedMessageFromTarget" &&
      params?.sessionId &&
      params.message
    ) {
      this.children.get(params.sessionId)?.receive(JSON.parse(params.message) as Message);
    } else if (message.method === "Target.detachedFromTarget" && params?.sessionId) {
      this.children.get(params.sessionId)?.dispose();
      this.children.delete(params.sessionId);
    } else if (
      message.method === "Fetch.requestPaused" &&
      params?.requestId &&
      params.request
    ) {
      const blocked = isProtectedBrowserAsset(params.request.url);
      void this.send(blocked ? "Fetch.failRequest" : "Fetch.continueRequest", {
        requestId: params.requestId,
        ...(blocked ? { errorReason: "BlockedByClient" } : {}),
      }).catch(() => {});
    }
  }

  dispose() {
    this.disposed = true;
    for (const pending of this.pending.values())
      pending.reject(new Error("Browser target closed."));
    this.pending.clear();
    for (const child of this.children.values()) child.dispose();
    this.children.clear();
  }
}

const guards = new WeakMap<Browser, Promise<void>>();

export function guardBrowserProxyRequests(context: BrowserContext) {
  const browser = context.browser();
  if (!browser) return Promise.reject(new Error("Proxy browsing requires a Chromium browser."));
  let installed = guards.get(browser);
  if (!installed) {
    installed = (async () => {
      const cdp = await browser.newBrowserCDPSession();
      const fail = (cause: unknown) => {
        void browser.close({ reason: `Proxy request guard failed: ${String(cause)}` }).catch(() => {});
      };
      const root: GuardSession = new GuardSession(async (payload) => {
        const command = JSON.parse(payload) as {
          id: number;
          method: string;
          params: { sessionId: string; message: string };
        };
        if (command.method !== "Target.sendMessageToTarget")
          throw new Error("Invalid guard command.");
        const result = await cdp.send("Target.sendMessageToTarget", command.params);
        root.receive({ id: command.id, result });
      }, fail);
      cdp.on("Target.attachedToTarget", (params) =>
        root.receive({ method: "Target.attachedToTarget", params }),
      );
      cdp.on("Target.receivedMessageFromTarget", (params) =>
        root.receive({ method: "Target.receivedMessageFromTarget", params }),
      );
      cdp.on("Target.detachedFromTarget", (params) =>
        root.receive({ method: "Target.detachedFromTarget", params }),
      );
      browser.once("disconnected", () => root.dispose());
      await cdp.send("Target.setAutoAttach", targets);
    })();
    guards.set(browser, installed);
  }
  return installed;
}
