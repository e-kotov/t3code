// @effect-diagnostics nodeBuiltinImport:off - Tests real Chromium and local proxy sockets.
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vite-plus/test";

import { BrowserProxyContexts } from "./BrowserProxyContexts.ts";

const listen = async (server: NodeNet.Server) => {
  server.listen(0, "127.0.0.1");
  await NodeEvents.once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port.");
  return address.port;
};

const close = (server: NodeNet.Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((cause) => (cause ? reject(cause) : resolve())),
  );

describe("browser proxy routes", () => {
  it("routes HTTP and SOCKS5 tabs independently, keeps localhost direct and fails closed", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-"));
    const requests: string[] = [];
    const local = NodeHttp.createServer((_request, response) => response.end("direct localhost"));
    const target = NodeHttp.createServer((_request, response) => response.end("SOCKS route"));
    const httpProxy = NodeHttp.createServer((request, response) => {
      requests.push(request.url ?? "");
      response.end("HTTP route");
    });
    const sockets = new Set<NodeNet.Socket>();
    const socksHosts: string[] = [];
    const targetPort = await listen(target);
    const socksProxy = NodeNet.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      let greeting = true;
      let buffer = Buffer.alloc(0);
      const receive = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (greeting) {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
          buffer = buffer.subarray(2 + buffer[1]!);
          socket.write(Buffer.from([5, 0]));
          greeting = false;
        }
        if (buffer.length < 5) return;
        if (buffer[0] !== 5 || buffer[1] !== 1 || buffer[3] !== 3) {
          socket.destroy();
          return;
        }
        const length = buffer[4]!;
        if (buffer.length < length + 7) return;
        const hostname = buffer.subarray(5, 5 + length).toString();
        socksHosts.push(hostname);
        if (hostname !== "route-check.invalid") {
          socket.destroy();
          return;
        }
        socket.off("data", receive);
        const remainder = buffer.subarray(length + 7);
        const upstream = NodeNet.connect(targetPort, "127.0.0.1", () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (remainder.length) upstream.write(remainder);
          socket.pipe(upstream).pipe(socket);
        });
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      };
      socket.on("data", receive);
    });
    const pool = new BrowserProxyContexts({
      profilesDir: NodePath.join(root, "profiles"),
      env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
      executable: async () => chromium.executablePath(),
    });
    try {
      const localPort = await listen(local);
      const httpUrl = `http://127.0.0.1:${await listen(httpProxy)}`;
      const socksUrl = `socks5://127.0.0.1:${await listen(socksProxy)}`;
      const httpContext = await pool.contextFor("default", "agent", httpUrl);
      const socksContext = await pool.contextFor("default", "agent", socksUrl);
      const directContext = await pool.contextFor("default", "agent", "");
      expect(new Set([httpContext, socksContext, directContext]).size).toBe(3);
      expect(await pool.contextFor("default", "agent", httpUrl)).toBe(httpContext);
      const httpPage = await httpContext.newPage();
      const socksPage = await socksContext.newPage();
      await httpPage.goto("http://route-check.invalid/");
      expect(await httpPage.textContent("body")).toBe("HTTP route");
      await socksPage.goto("http://route-check.invalid/");
      expect(await socksPage.textContent("body")).toBe("SOCKS route");
      expect(requests).toContain("http://route-check.invalid/");
      expect(socksHosts).toContain("route-check.invalid");
      await httpContext.addCookies([
        { name: "route", value: "http", url: "http://route-check.invalid" },
      ]);
      expect(await socksContext.cookies("http://route-check.invalid")).toEqual([]);
      await httpPage.goto(`http://127.0.0.1:${localPort}`);
      expect(await httpPage.textContent("body")).toBe("direct localhost");
      await socksPage.close();
      for (const socket of sockets) socket.destroy();
      await close(socksProxy);
      await expect(
        (await socksContext.newPage()).goto("http://route-check.invalid/"),
      ).rejects.toThrow();
      // A failed SOCKS route must not change the independently working HTTP route.
      await httpPage.goto("http://route-check.invalid/");
      expect(await httpPage.textContent("body")).toBe("HTTP route");
    } finally {
      await pool.close();
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [local, target, httpProxy, socksProxy].filter((server) => server.listening).map(close),
      );
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("clears persistent proxy profiles including routes not opened since restart", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-profiles-"));
    const profilesDir = NodePath.join(root, "profiles");
    const options = {
      profilesDir,
      env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
      executable: async () => chromium.executablePath(),
    };
    const pool = new BrowserProxyContexts(options);
    const route = "http://127.0.0.1:1";
    try {
      const profile = await pool.contextFor("work", undefined, route);
      await profile.addCookies([
        { name: "login", value: "saved", url: "http://example.invalid", expires: 4_102_444_800 },
      ]);
      const other = await pool.contextFor("other", undefined, route);
      await other.addCookies([
        { name: "login", value: "keep", url: "http://example.invalid", expires: 4_102_444_800 },
      ]);
      await pool.close();
      const restarted = new BrowserProxyContexts(options);
      try {
        await restarted.clearProfile("work");
        expect(await (await restarted.contextFor("work", undefined, route)).cookies()).toEqual([]);
        expect(
          (await (await restarted.contextFor("other", undefined, route)).cookies()).map(
            (cookie) => cookie.value,
          ),
        ).toContain("keep");
      } finally {
        await restarted.close();
      }
    } finally {
      await pool.close();
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
