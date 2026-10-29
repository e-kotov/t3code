// @effect-diagnostics nodeBuiltinImport:off - Owns Playwright resources outside the Effect runtime.
import { normalizeBrowserProxyUrl } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { BrowserContext } from "playwright-core";

import { ServerBrowserContexts } from "./ServerBrowserContexts.ts";

type Options = ConstructorParameters<typeof ServerBrowserContexts>[0];
interface RoutePool {
  readonly pool: ServerBrowserContexts;
  readonly contexts: Set<BrowserContext>;
  pending: number;
}

export class BrowserProxyContexts {
  private readonly pools = new Map<string, RoutePool>();
  private readonly retiring = new Map<string, Promise<void>>();
  private readonly profileOperations = new Map<string, Promise<void>>();
  private readonly watched = new WeakSet<BrowserContext>();
  private readonly options: Options;
  private closed = false;

  constructor(options: Options) { this.options = options; }

  private async routePool(route: string): Promise<RoutePool> {
    await this.retiring.get(route);
    if (this.closed) throw new Error("The preview browser is closed.");
    const existing = this.pools.get(route);
    if (existing) return existing;
    const contexts = new Set<BrowserContext>();
    const pool = new ServerBrowserContexts({
      ...this.options,
      proxyUrl: route,
      profilesDir: route ? NodePath.join(`${this.options.profilesDir}-proxy-routes`, this.routeId(route)) : this.options.profilesDir,
      onContextClose: (context) => {
        contexts.delete(context);
        this.options.onContextClose?.(context);
        this.retire(route, record);
      },
    });
    const record: RoutePool = { pool, contexts, pending: 0 };
    this.pools.set(route, record);
    return record;
  }

  private retire(route: string, record: RoutePool) {
    if (!route || record.pending || record.contexts.size || this.pools.get(route) !== record) return;
    this.pools.delete(route);
    const closing = record.pool.close();
    this.retiring.set(route, closing);
    void closing.then(() => { if (this.retiring.get(route) === closing) this.retiring.delete(route); }, () => {});
  }

  private routeId(route: string) {
    return NodeCrypto.createHash("sha256").update(route).digest("hex");
  }

  private withProfile<A>(profileId: string, operation: () => Promise<A>): Promise<A> {
    const pending = (this.profileOperations.get(profileId) ?? Promise.resolve()).then(operation);
    const settled = pending.then(() => {}, () => {});
    this.profileOperations.set(profileId, settled);
    void settled.then(() => { if (this.profileOperations.get(profileId) === settled) this.profileOperations.delete(profileId); });
    return pending;
  }

  contextFor(profileId: string, isolationKey?: string, proxyUrl?: string) {
    return this.withProfile(profileId, async () => {
      const route = normalizeBrowserProxyUrl(proxyUrl ?? "");
      const record = await this.routePool(route);
      record.pending += 1;
      try {
        const context = await record.pool.contextFor(profileId, isolationKey);
        record.contexts.add(context);
        if (route && !this.watched.has(context)) {
          this.watched.add(context);
          context.on("page", (page) => page.once("close", () => {
            if (context.pages().some((candidate) => !candidate.isClosed())) return;
            void this.withProfile(profileId, () => context.close()).catch(() => {});
          }));
        }
        return context;
      } finally {
        record.pending -= 1;
        this.retire(route, record);
      }
    });
  }

  async scratchPage() { return (await this.routePool("")).pool.scratchPage(); }
  async connectDesktopPage(endpoint: string) { return (await this.routePool("")).pool.connectDesktopPage(endpoint); }

  clearProfile(profileId: string) {
    return this.withProfile(profileId, async () => {
      const live = [...this.pools.entries()];
      const cleared = new Set(live.filter(([route]) => route).map(([route]) => this.routeId(route)));
      for (const [, record] of live) await record.pool.clearProfile(profileId);
      if (!live.some(([route]) => route === "")) await (await this.routePool("")).pool.clearProfile(profileId);
      await Promise.all(this.retiring.values());
      const root = `${this.options.profilesDir}-proxy-routes`;
      const routes = await NodeFSP.readdir(root).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return [];
        throw cause;
      });
      for (const route of routes) {
        if (!/^[a-f0-9]{64}$/.test(route) || cleared.has(route)) continue;
        const pool = new ServerBrowserContexts({ ...this.options, profilesDir: NodePath.join(root, route) });
        try { await pool.clearProfile(profileId); } finally { await pool.close(); }
      }
    });
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.profileOperations.values()]);
    await Promise.all([...this.pools.values()].map((record) => record.pool.close()));
    await Promise.all(this.retiring.values());
  }
}
