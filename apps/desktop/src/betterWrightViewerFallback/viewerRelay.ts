// @effect-diagnostics nodeBuiltinImport:off - The relay owns its loopback Node HTTP server.
import * as NodeHttp from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import {
  HttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { ViewerFallbackError } from "./viewerForward.ts";
import { type ViewerData, ViewerPageGate } from "./viewerPageGate.ts";

export interface ViewerRelay {
  readonly localPort: number;
  /** The window's own capability; the daemon's token never leaves this process. */
  readonly windowToken: string;
}

const textDecoder = new TextDecoder();

/**
 * Serves BetterWright's viewer page and its socket on a loopback port of its own, so the window
 * never talks to the daemon directly: every frame, page message and operation passes the
 * window's `ViewerPageGate`. Requests carry capability tokens, so nothing here is logged or
 * traced. Closing the scope stops the server and every relayed socket.
 */
export const startViewerRelay = Effect.fn("desktop.betterWrightFallback.startRelay")(function* (
  input: {
    readonly upstreamPort: number;
    readonly token: string;
    readonly pageId: string;
  },
  makeUpstream: (url: string) => WebSocket = (url) => new WebSocket(url),
) {
  const client = yield* HttpClient.HttpClient;
  const windowToken = SecureRandom.uuidV4Unsafe().replaceAll("-", "");
  const upstreamQuery = `t=${encodeURIComponent(input.token)}`;
  let localPort = 0;
  const allowed = (request: HttpServerRequest.HttpServerRequest) =>
    new URL(request.url, "http://127.0.0.1").searchParams.get("t") === windowToken;

  const page = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!allowed(request)) return HttpServerResponse.text("Not found", { status: 404 });
    const response = yield* client
      .get(`http://127.0.0.1:${input.upstreamPort}/?${upstreamQuery}`)
      .pipe(Effect.provideService(HttpClient.TracerDisabledWhen, () => true));
    return HttpServerResponse.text(yield* response.text, {
      status: response.status,
      contentType: "text/html; charset=utf-8",
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  }).pipe(
    Effect.orElseSucceed(() => HttpServerResponse.text("Viewer unavailable", { status: 502 })),
  );

  const relaySocket = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = request.headers.origin;
    if (
      !allowed(request) ||
      request.headers.upgrade?.toLowerCase() !== "websocket" ||
      (origin !== undefined && origin !== `http://127.0.0.1:${localPort}`)
    ) {
      return HttpServerResponse.text("Not found", { status: 404 });
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const gate = new ViewerPageGate(input.pageId);
        const fromViewer = yield* Queue.unbounded<ViewerData>();
        const viewerClosed = yield* Deferred.make<void>();
        const viewerOpened = yield* Deferred.make<void>();
        const viewer = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const socket = makeUpstream(`ws://127.0.0.1:${input.upstreamPort}/ws?${upstreamQuery}`);
            socket.binaryType = "arraybuffer";
            socket.addEventListener("open", () => Deferred.doneUnsafe(viewerOpened, Effect.void));
            socket.addEventListener("message", (event) => {
              const data: unknown = event.data;
              if (typeof data === "string") Queue.offerUnsafe(fromViewer, data);
              else if (data instanceof ArrayBuffer)
                Queue.offerUnsafe(fromViewer, new Uint8Array(data));
            });
            socket.addEventListener("close", () => Deferred.doneUnsafe(viewerClosed, Effect.void));
            return socket;
          }),
          (socket) => Effect.sync(() => socket.close()),
        );
        yield* Effect.raceFirst(Deferred.await(viewerOpened), Deferred.await(viewerClosed));
        const toViewer = (message: string) => {
          if (viewer.readyState === WebSocket.OPEN) viewer.send(message);
        };
        const socket = yield* request.upgrade;
        const reader = yield* socket.reader;
        const writer = yield* socket.writer;
        const downstream = Queue.take(fromViewer).pipe(
          Effect.flatMap((data) => {
            const result = gate.fromViewer(data);
            if (result.toViewer !== null) toViewer(result.toViewer);
            return result.toWindow === null ? Effect.void : writer.write(result.toWindow);
          }),
        );
        const upstream = reader.pull.pipe(
          Effect.map((chunks) => {
            for (const chunk of chunks) {
              // The viewer page sends only JSON text; frame type is not preserved by the reader.
              const forwarded = gate.fromWindow(
                typeof chunk === "string" ? chunk : textDecoder.decode(chunk),
              );
              if (forwarded !== null) toViewer(forwarded);
            }
          }),
        );
        yield* Effect.raceAll([
          Effect.forever(downstream),
          Effect.forever(upstream),
          Deferred.await(viewerClosed),
        ]);
        return HttpServerResponse.empty();
      }),
    ).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty()));
  });

  const routes = HttpRouter.use((router) =>
    Effect.gen(function* () {
      yield* router.add("GET", "/", page);
      yield* router.add("GET", "/ws", relaySocket);
    }),
  );
  const server = yield* Layer.build(
    HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
      Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)),
      Layer.provideMerge(
        NodeHttpServer.layer(() => NodeHttp.createServer(), {
          port: 0,
          host: "127.0.0.1",
          gracefulShutdownTimeout: 1_000,
        }),
      ),
    ),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new ViewerFallbackError({ message: "The SSH viewer relay could not start.", cause }),
    ),
  );
  localPort = Number(
    new URL(HttpServer.formatAddress(Context.get(server, HttpServer.HttpServer).address)).port,
  );
  return { localPort, windowToken } satisfies ViewerRelay;
});
