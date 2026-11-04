// @effect-diagnostics nodeBuiltinImport:off - Drives real loopback sockets through the relay.
import * as NodeHttp from "node:http";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import {
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { startViewerRelay } from "./viewerRelay.ts";

const TARGET = "page-target";
const TOKEN = "daemon-capability-token-1";
type Message = Record<string, unknown>;

/**
 * A daemon speaking BetterWright 1.10.2's live-view protocol for two pages. On join it sends
 * hello, the cached frame of the active (preferred) page and another tab's thumb before any
 * meta, then meta for the preferred page; `{t:"tab"}` switches only once allowed.
 */
const fakeDaemon = Effect.gen(function* () {
  const received: Message[] = [];
  const reselected = yield* Deferred.make<void>();
  const markerSeen = yield* Deferred.make<void>();
  const refreshSeen = yield* Deferred.make<void>();
  let switched = false;
  const allowSwitch = yield* Deferred.make<void>();
  const outbox = yield* Queue.unbounded<string | Uint8Array>();
  const pageRequests: string[] = [];
  const routes = HttpRouter.use((router) =>
    Effect.gen(function* () {
      yield* router.add(
        "GET",
        "/",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          pageRequests.push(request.url);
          return request.url.includes(`t=${TOKEN}`)
            ? HttpServerResponse.text("<html>betterwright viewer</html>", {
                contentType: "text/html",
              })
            : HttpServerResponse.text("Not found", { status: 404 });
        }),
      );
      yield* router.add(
        "GET",
        "/ws",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (!request.url.includes(`t=${TOKEN}`)) return HttpServerResponse.empty({ status: 404 });
          const socket = yield* request.upgrade;
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          for (const message of [
            JSON.stringify({ t: "hello", interactive: true, agent: "driving" }),
            new Uint8Array([1, 1]),
            JSON.stringify({ t: "thumb", id: "preferred", thumb: "data:other-page" }),
            JSON.stringify({ t: "meta", pageId: "preferred", url: "https://mail.example" }),
            new Uint8Array([2, 2]),
          ])
            yield* writer.write(message);
          const receive = reader.pull.pipe(
            Effect.flatMap((chunks) =>
              Effect.forEach(
                chunks,
                Effect.fnUntraced(function* (chunk) {
                  const message = JSON.parse(
                    typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
                  ) as Message;
                  received.push(message);
                  if (message.t === "vis") yield* Deferred.succeed(markerSeen, undefined);
                  if (message.t === "refresh") yield* Deferred.succeed(refreshSeen, undefined);
                  // Switches once; later reselects are only recorded.
                  if (message.t === "tab" && message.id === TARGET && !switched) {
                    switched = true;
                    yield* Deferred.succeed(reselected, undefined);
                    yield* Effect.gen(function* () {
                      yield* Deferred.await(allowSwitch);
                      yield* writer.write(
                        JSON.stringify({ t: "meta", pageId: TARGET, url: "https://login.example" }),
                      );
                      yield* writer.write(new Uint8Array([5, 5]));
                    }).pipe(Effect.forkScoped);
                  }
                }),
                { discard: true },
              ),
            ),
          );
          const send = Queue.take(outbox).pipe(Effect.flatMap((data) => writer.write(data)));
          return yield* Effect.raceFirst(Effect.forever(receive), Effect.forever(send));
        }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty())),
      );
    }),
  );
  const server = yield* Layer.build(
    HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layerTest),
    ),
  );
  const port = Number(
    new URL(HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)).port,
  );
  return {
    port,
    received,
    reselected,
    markerSeen,
    refreshSeen,
    allowSwitch,
    outbox,
    pageRequests,
  };
});

function windowClient(url: string) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const texts: Message[] = [];
  const frames: number[][] = [];
  const waiters: Array<() => void> = [];
  let opened = false;
  const open = new Promise<boolean>((resolve) => {
    socket.addEventListener("open", () => {
      opened = true;
      resolve(true);
    });
    socket.addEventListener("close", () => resolve(opened));
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") texts.push(JSON.parse(event.data) as Message);
    else frames.push([...new Uint8Array(event.data as ArrayBuffer)]);
    for (const wake of waiters.splice(0)) wake();
  });
  const until = (predicate: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (predicate()) return resolve();
        if (socket.readyState === WebSocket.CLOSED)
          return reject(new Error("window socket closed"));
        waiters.push(check);
      };
      socket.addEventListener("close", check);
      check();
    });
  return { socket, texts, frames, open, until };
}

describe("exact-page viewer relay", () => {
  it.live(
    "keeps every other page's frame, metadata and the window's input out until the page is confirmed",
    () =>
      Effect.gen(function* () {
        const daemon = yield* fakeDaemon;
        const relay = yield* startViewerRelay({
          upstreamPort: daemon.port,
          token: TOKEN,
          pageId: TARGET,
        });
        expect(relay.windowToken).not.toContain(TOKEN);
        const base = `127.0.0.1:${relay.localPort}`;
        const client = yield* HttpClient.HttpClient;

        const refused = yield* client.get(`http://${base}/?t=${TOKEN}`);
        expect(refused.status).toBe(404);
        const page = yield* client.get(`http://${base}/?t=${relay.windowToken}`);
        expect(yield* page.text).toBe("<html>betterwright viewer</html>");
        expect(page.headers["cache-control"]).toBe("no-store");
        expect(daemon.pageRequests.every((url) => url.includes(TOKEN))).toBe(true);
        const foreignOrigin = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const request = NodeHttp.request({
                host: "127.0.0.1",
                port: relay.localPort,
                path: `/ws?t=${relay.windowToken}`,
                headers: {
                  connection: "Upgrade",
                  upgrade: "websocket",
                  origin: "https://attacker.example",
                  "sec-websocket-version": "13",
                  "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
                },
              });
              request.on("response", (response) => resolve(response.statusCode ?? 0));
              request.on("upgrade", () => resolve(101));
              request.end();
            }),
        );
        expect(foreignOrigin).toBe(404);
        const wrongToken = windowClient(`ws://${base}/ws?t=${TOKEN}`);
        expect(yield* Effect.promise(() => wrongToken.open)).toBe(false);

        const window = yield* Effect.acquireRelease(
          Effect.sync(() => windowClient(`ws://${base}/ws?t=${relay.windowToken}`)),
          (client) => Effect.sync(() => client.socket.close()),
        );
        expect(yield* Effect.promise(() => window.open)).toBe(true);
        // The gate asks the daemon to reselect after seeing the preferred page's meta.
        yield* Deferred.await(daemon.reselected);
        window.socket.send(JSON.stringify({ t: "input", kind: "insertText", text: "too early" }));
        window.socket.send(JSON.stringify({ t: "navigate", url: "https://elsewhere.example" }));
        window.socket.send(JSON.stringify({ t: "vis", hidden: false }));
        yield* Deferred.await(daemon.markerSeen);
        expect(daemon.received.filter((m) => m.t === "input" || m.t === "navigate")).toEqual([]);

        yield* Deferred.succeed(daemon.allowSwitch, undefined);
        yield* Effect.promise(() => window.until(() => window.frames.length > 0));
        expect(window.frames).toEqual([[5, 5]]);
        expect(window.texts.map((m) => m.t)).toEqual(["hello", "meta"]);
        expect(window.texts[1]).toMatchObject({ pageId: TARGET });
        expect(JSON.stringify(window.texts)).not.toContain("mail.example");

        window.socket.send(JSON.stringify({ t: "input", kind: "insertText", text: "answer" }));
        window.socket.send(JSON.stringify({ t: "refresh" }));
        yield* Deferred.await(daemon.refreshSeen);
        expect(daemon.received.filter((m) => m.t === "input")).toEqual([
          { t: "input", kind: "insertText", text: "answer" },
        ]);

        // Another client makes the daemon stream a different page: the window closes again.
        yield* Queue.offer(daemon.outbox, JSON.stringify({ t: "meta", pageId: "preferred" }));
        yield* Queue.offer(daemon.outbox, new Uint8Array([2, 2]));
        yield* Queue.offer(daemon.outbox, JSON.stringify({ t: "meta", pageId: TARGET }));
        yield* Queue.offer(daemon.outbox, new Uint8Array([6, 6]));
        yield* Effect.promise(() => window.until(() => window.frames.length > 1));
        expect(window.frames).toEqual([
          [5, 5],
          [6, 6],
        ]);
      }).pipe(Effect.provide(NodeHttpClient.layerUndici), Effect.scoped),
  );
});
