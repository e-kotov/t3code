// @effect-diagnostics nodeBuiltinImport:off - Owns Playwright resources outside the Effect runtime.
import { normalizeBrowserProxyUrl } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { ServerBrowserContexts } from "./ServerBrowserContexts.ts";

type Options = ConstructorParameters<typeof ServerBrowserContexts>[0];

/** Each route owns its contexts and profile storage; changing one tab never reroutes another. */
export class BrowserProxyContexts {
  private readonly pools = new Map<string, ServerBrowserContexts>();
  private closed = false;

  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  private pool(proxyUrl = "") {
    if (this.closed) throw new Error("The preview browser is closed.");
    const route = normalizeBrowserProxyUrl(proxyUrl);
    const existing = this.pools.get(route);
    if (existing) return existing;
    const pool = new ServerBrowserContexts({
      ...this.options,
      proxyUrl: route,
      profilesDir: route
        ? NodePath.join(`${this.options.profilesDir}-proxy-routes`, this.routeId(route))
        : this.options.profilesDir,
    });
    this.pools.set(route, pool);
    return pool;
  }

  private routeId(route: string) {
    return NodeCrypto.createHash("sha256").update(route).digest("hex");
  }

  contextFor(profileId: string, isolationKey?: string, proxyUrl?: string) {
    return this.pool(proxyUrl).contextFor(profileId, isolationKey);
  }

  scratchPage() {
    return this.pool().scratchPage();
  }
  connectDesktopPage(endpoint: string) {
    return this.pool().connectDesktopPage(endpoint);
  }

  async clearProfile(profileId: string) {
    await Promise.all([...this.pools.values()].map((pool) => pool.clearProfile(profileId)));
    if (!this.pools.has("")) await this.pool().clearProfile(profileId);
    const root = `${this.options.profilesDir}-proxy-routes`;
    const routes = await NodeFSP.readdir(root).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return [];
      throw cause;
    });
    for (const route of routes) {
      if (!/^[a-f0-9]{64}$/.test(route)) continue;
      const pool = new ServerBrowserContexts({
        ...this.options,
        profilesDir: NodePath.join(root, route),
      });
      await pool.clearProfile(profileId);
      await pool.close();
    }
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
  }
}
