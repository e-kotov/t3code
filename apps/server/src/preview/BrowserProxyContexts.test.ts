// @effect-diagnostics nodeBuiltinImport:off - Tests real Chromium and local proxy sockets.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { chromium } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";

import { BrowserProxyContexts } from "./BrowserProxyContexts.ts";

vi.mock("node:fs/promises", { spy: true });

const listen = (server: NodeNet.Server, host = "127.0.0.1") =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Missing fixture port."));
      else resolve(address.port);
    });
  });

const close = (server: NodeNet.Server) =>
  new Promise<void>((resolve, reject) =>
    server.close((cause) => (cause ? reject(cause) : resolve())),
  );

describe("browser proxy routes", () => {
  it("routes HTTP and SOCKS5 tabs independently, keeps localhost direct and fails closed", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-"));
    const requests: string[] = [];
    let directRequests = 0;
    const directTarget = NodeHttp.createServer((request, response) => {
      if (request.url === "/probe") directRequests += 1;
      response.end("reachable directly");
    });
    const local = NodeHttp.createServer((_request, response) => response.end("direct localhost"));
    const target = NodeHttp.createServer((_request, response) => response.end("SOCKS route"));
    const protectedUrl = `http://route-check.invalid/api/assets/cGF5bG9hZA.${"a".repeat(43)}/report.html`;
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
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        sockets.add(upstream);
        upstream.on("close", () => sockets.delete(upstream));
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      };
      socket.on("data", receive);
    });
    const address = Object.values(NodeOS.networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
    const pool = new BrowserProxyContexts({
      args: address ? [`--host-resolver-rules=MAP proxy-direct.test ${address}`] : [],
      profilesDir: NodePath.join(root, "profiles"),
      env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
      executable: async () => chromium.executablePath(),
    });
    try {
      const localPort = await listen(local);
      if (!address) throw new Error("The proxy fixture needs a non-loopback IPv4 address.");
      const directUrl = `http://proxy-direct.test:${await listen(directTarget, "0.0.0.0")}/probe`;
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
      // A blocked navigation commits Chromium's error page; keep it off the page reused below.
      const blockedPage = await httpContext.newPage();
      await expect(blockedPage.goto(protectedUrl)).rejects.toThrow();
      await blockedPage.close();
      expect(requests).not.toContain(protectedUrl);
      await httpPage.goto("http://route-check.invalid/api/assets/public/report.js");
      expect(await httpPage.textContent("body")).toBe("HTTP route");
      const blockedPopup = Promise.withResolvers<void>();
      httpContext.on("requestfailed", (request) => {
        if (request.url() === protectedUrl) blockedPopup.resolve();
      });
      const popupOpened = httpPage.waitForEvent("popup");
      await httpPage.evaluate(`void window.open(${JSON.stringify(protectedUrl)})`);
      const popup = await popupOpened;
      await blockedPopup.promise;
      expect(requests).not.toContain(protectedUrl);
      await popup.close();
      await httpPage.goto(directUrl.replace("proxy-direct.test", address));
      expect(await httpPage.textContent("body")).toBe("reachable directly");

      await httpContext.addCookies([
        { name: "route", value: "http", url: "http://route-check.invalid" },
      ]);
      expect(await socksContext.cookies("http://route-check.invalid")).toEqual([]);
      await httpPage.goto(`http://127.0.0.1:${localPort}`);
      expect(await httpPage.textContent("body")).toBe("direct localhost");
      const directPage = await directContext.newPage();
      await directPage.goto(directUrl);
      expect(await directPage.textContent("body")).toBe("reachable directly");
      directRequests = 0;
      for (const socket of sockets) socket.destroy();
      await close(socksProxy);
      await expect((await socksContext.newPage()).goto(directUrl)).rejects.toThrow();
      expect(directRequests).toBe(0);
      // A failed SOCKS route must not change the independently working HTTP route.
      await httpPage.goto("http://route-check.invalid/");
      expect(await httpPage.textContent("body")).toBe("HTTP route");
    } finally {
      await pool.close();
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [local, target, httpProxy, socksProxy, directTarget]
          .filter((server) => server.listening)
          .map(close),
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

it("waits for all route deletion before reopening a profile", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-clear-"));
  const profilesDir = NodePath.join(root, "profiles");
  const pool = new BrowserProxyContexts({
    profilesDir,
    env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
    executable: async () => chromium.executablePath(),
  });
  const route = "http://127.0.0.1:1";
  try {
    await pool.contextFor("work", undefined, route);
    const [routeId] = await NodeFSP.readdir(`${profilesDir}-proxy-routes`);
    const directory = NodePath.join(`${profilesDir}-proxy-routes`, routeId!, "work");
    const remove = (await vi.importActual<typeof NodeFSP>("node:fs/promises")).rm;
    let reopening: ReturnType<BrowserProxyContexts["contextFor"]> | undefined;
    let deletions = 0;
    let deletedWhileReopened = false;
    const removeMock = vi.mocked(NodeFSP.rm);
    removeMock.mockImplementation(async (path, options) => {
      if (String(path) === directory) {
        deletions += 1;
        if (deletions === 1) reopening = pool.contextFor("work", undefined, route);
        else {
          await reopening;
          deletedWhileReopened = true;
          return;
        }
      }
      return remove(path, options);
    });
    try {
      await pool.clearProfile("work");
      expect(reopening).toBeDefined();
      await reopening;
      expect(deletedWhileReopened).toBe(false);
      expect((await NodeFSP.stat(directory)).isDirectory()).toBe(true);
    } finally {
      removeMock.mockRestore();
    }
  } finally {
    await pool.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("releases idle route browsers before a proxy is used again", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-idle-"));
  const pool = new BrowserProxyContexts({
    profilesDir: NodePath.join(root, "profiles"),
    env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
    executable: async () => chromium.executablePath(),
  });
  try {
    const first = await pool.contextFor("default", "agent", "socks5://127.0.0.1:1");
    const browser = first.browser();
    const page = await first.newPage();
    await page.close();
    const next = await pool.contextFor("default", "agent", "socks5://127.0.0.1:1");
    expect(next).not.toBe(first);
    expect(browser?.isConnected()).toBe(false);
  } finally {
    await pool.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("keeps a new page lease alive when the previous last page closes", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-proxy-lease-"));
  const pool = new BrowserProxyContexts({
    profilesDir: NodePath.join(root, "profiles"),
    env: { ...process.env, T3CODE_SERVER_BROWSER_SANDBOX: "0" },
    executable: async () => chromium.executablePath(),
  });
  try {
    const route = "socks5://127.0.0.1:1";
    const first = await pool.pageFor("default", "agent", route, async () => {});
    const preparing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const opening = pool.pageFor("default", "agent", route, async () => {
      preparing.resolve();
      await resume.promise;
    });
    await preparing.promise;
    await first.page.close();
    resume.resolve();
    const next = await opening;
    expect(next.page.isClosed()).toBe(false);
    expect(await next.page.evaluate(() => 1 + 1)).toBe(2);
  } finally {
    await pool.close();
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
