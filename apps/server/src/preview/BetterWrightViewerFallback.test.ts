// @effect-diagnostics nodeBuiltinImport:off - Exercises a viewer process and real WebSocket hops.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSessionId,
  BETTERWRIGHT_VIEWER_FALLBACK_COMPLETE_MESSAGE,
  BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import { expect } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Handoff from "./BetterWrightHandoff.ts";
import * as Fallback from "./BetterWrightViewerFallback.ts";
import * as Manager from "./Manager.ts";
import * as ServerBrowser from "./ServerBrowser.ts";
import { routeLayer as streamRouteLayer } from "./ServerBrowserStream.ts";

const platform = NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer));
const TOKEN = "private-fallback-token-0123";
type Message = Record<string, unknown>;

function client(url: string) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const messages: Message[] = [];
  const waiters: Array<{
    predicate: (message: Message) => boolean;
    resolve: (m: Message) => void;
    reject: (error: Error) => void;
  }> = [];
  let opened = false;
  socket.addEventListener("open", () => {
    opened = true;
  });
  let closeCode: number | null = null;
  const closed = new Promise<{ code: number; reason: string; opened: boolean }>((resolve) =>
    socket.addEventListener("close", (event) => {
      closeCode = event.code;
      // A socket that closes first fails its pending waits instead of hanging the test.
      for (const waiter of waiters.splice(0))
        waiter.reject(new Error(`socket closed with ${event.code} before the message`));
      resolve({ code: event.code, reason: event.reason, opened });
    }),
  );
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      socket.send(JSON.stringify({ type: "ack" }));
      return;
    }
    const message = JSON.parse(event.data) as Message;
    messages.push(message);
    for (const waiter of waiters.filter((candidate) => candidate.predicate(message))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  const next = (predicate: (message: Message) => boolean) =>
    new Promise<Message>((resolve, reject) => {
      const found = messages.find(predicate);
      if (found) resolve(found);
      else if (closeCode !== null) reject(new Error(`socket closed with ${closeCode}`));
      else waiters.push({ predicate, resolve, reject });
    });
  return { socket, messages, closed, next };
}

it.live(
  "lends the active handoff's viewer to one authorized SSH fallback and keeps control ownership",
  () =>
    Effect.gen(function* () {
      const upstreamInputs: Message[] = [];
      const repointed = Promise.withResolvers<void>();
      const upstreamOutbox = yield* Queue.unbounded<Message>();
      const upstreamRoutes = HttpRouter.use((router) =>
        router.add(
          "GET",
          "/ws",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const socket = yield* request.upgrade;
            const writer = yield* socket.writer;
            const reader = yield* socket.reader;
            for (const message of [
              { t: "hello", interactive: true },
              { t: "meta", pageId: "page-1", deviceWidth: 800, deviceHeight: 600 },
              {
                t: "tabs",
                tabs: [{ id: "page-1", sessionId: "research", streaming: true }],
              },
            ])
              yield* writer.write(JSON.stringify(message));
            yield* writer.write(new Uint8Array([255, 216, 255, 217]));
            const receive = reader.pull.pipe(
              Effect.map((chunks) => {
                for (const chunk of chunks) {
                  const message = JSON.parse(
                    typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
                  ) as Message;
                  upstreamInputs.push(message);
                  if (message.t === "tab" && message.id === "page-1") repointed.resolve();
                }
              }),
            );
            const send = Queue.take(upstreamOutbox).pipe(
              Effect.flatMap((message) => writer.write(JSON.stringify(message))),
            );
            yield* Effect.raceFirst(Effect.forever(receive), Effect.forever(send));
          }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty())),
        ),
      );
      const upstream = yield* Layer.build(
        HttpRouter.serve(upstreamRoutes.pipe(Layer.provide(platform)), {
          disableListenLog: true,
        }).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
      );
      const upstreamPort = Number(
        new URL(HttpServer.formatAddress(Context.get(upstream, HttpServer.HttpServer).address))
          .port,
      );
      const viewerUrl = `http://127.0.0.1:${upstreamPort}/?t=${TOKEN}`;
      const script = `process.on('SIGTERM',()=>process.exit(0));console.log(${JSON.stringify(viewerUrl)});setInterval(()=>{},1000);`;
      const previousView = process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND;
      const previousRun = process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND;
      process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND = JSON.stringify([
        process.execPath,
        "-e",
        script,
        "--",
      ]);
      process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND = JSON.stringify([process.execPath]);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previousView === undefined) delete process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND;
          else process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND = previousView;
          if (previousRun === undefined) delete process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND;
          else process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND = previousRun;
        }),
      );

      const handoff = yield* Handoff.BetterWrightHandoff;
      const manager = yield* Manager.PreviewManager;
      const subscription = yield* manager.subscribeEvents;
      const threadId = ThreadId.make("fallback-thread");
      const request = yield* handoff
        .request(threadId, { session: "research", pageId: "page-1", prompt: "Solve the check" })
        .pipe(Effect.forkScoped);
      const opened = yield* PubSub.take(subscription);
      expect(opened.type).toBe("opened");
      const tabId = opened.tabId;

      const browser = ServerBrowser.ServerBrowser.of({
        clearProfile: () => Effect.void,
        profileReporter: Effect.succeed(() => Effect.void),
        openDownload: () => Effect.succeedNone,
        answerFileChooser: () => Effect.succeed(false),
        attachViewer: (input) =>
          handoff.attachViewer(input).pipe(
            Effect.filterOrFail(
              (viewer) => viewer !== undefined,
              () => new ServerBrowser.ServerBrowserTabNotFoundError(input),
            ),
          ),
      });
      const routes = Layer.mergeAll(
        streamRouteLayer.pipe(Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser))),
        Fallback.routeLayer.pipe(
          Layer.provide(
            Layer.mock(ServerEnvironment.ServerEnvironment, {
              getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-gwdg")),
            }),
          ),
        ),
      ).pipe(Layer.provide(platform));
      // The ticket names the grant so one server can exercise each scope.
      const serverContext = yield* Layer.build(
        HttpRouter.serve(routes, { disableListenLog: true }).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provide(
            Layer.mock(EnvironmentAuth.EnvironmentAuth, {
              authenticateWebSocketUpgrade: (incoming) => {
                const ticket = new URL(incoming.url, "http://localhost").searchParams.get(
                  "wsTicket",
                );
                if (ticket === "denied")
                  return Effect.fail(
                    new EnvironmentAuth.ServerAuthInvalidCredentialError({ diagnostic: "denied" }),
                  );
                return Effect.succeed({
                  sessionId: AuthSessionId.make(`client-${ticket}`),
                  subject: "client",
                  method: "bearer-access-token",
                  scopes:
                    ticket === "reader"
                      ? [AuthOrchestrationReadScope]
                      : [AuthOrchestrationReadScope, AuthPreviewOperateScope],
                });
              },
            }),
          ),
        ),
      );
      const origin = HttpServer.formatAddress(
        Context.get(serverContext, HttpServer.HttpServer).address,
      ).replace(/^http/, "ws");
      // Scoped, so a failed assertion still closes every socket and the servers can stop.
      const connect = (url: string) =>
        Effect.acquireRelease(
          Effect.sync(() => client(url)),
          (connection) => Effect.sync(() => connection.socket.close()),
        );
      const lease = (ticket: string, tab = tabId) =>
        connect(
          `${origin}${BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH}?threadId=${threadId}&tabId=${tab}&wsTicket=${ticket}`,
        );
      const closes: Array<{ code: number; reason: string; opened: boolean }> = [];
      const closedWith = async (connection: ReturnType<typeof client>) => {
        const result = await connection.closed;
        closes.push(result);
        return result;
      };

      const refused = yield* lease("denied");
      const denied = yield* Effect.promise(() => closedWith(refused));
      expect(denied.opened).toBe(false);
      const reader = yield* lease("reader");
      expect(yield* Effect.promise(() => closedWith(reader))).toMatchObject({ code: 4403 });
      expect(reader.messages).toEqual([]);
      const stale = yield* lease("operator", "another-tab");
      expect(yield* Effect.promise(() => closedWith(stale))).toMatchObject({ code: 4404 });

      const first = yield* lease("operator");
      const viewer = yield* Effect.promise(() => first.next((m) => m.type === "viewer"));
      expect(viewer).toEqual({
        type: "viewer",
        environmentId: "environment-gwdg",
        threadId,
        tabId,
        pageId: "page-1",
        port: upstreamPort,
        token: TOKEN,
      });

      const stream = yield* connect(
        `${origin}/api/preview-stream/ws?threadId=${threadId}&tabId=${tabId}&wsTicket=operator`,
      );
      yield* Effect.promise(() =>
        stream.next((m) => m.type === "control" && m.controller === "another-viewer"),
      );
      stream.socket.send(JSON.stringify({ type: "takeControl" }));
      stream.socket.send(JSON.stringify({ type: "text", text: "must not reach the page" }));
      const busy = yield* lease("operator");
      expect(yield* Effect.promise(() => closedWith(busy))).toMatchObject({ code: 4409 });

      // A standalone viewer joining makes BetterWright stream the preferred tab.
      yield* Queue.offer(upstreamOutbox, { t: "meta", pageId: "preferred-page" });
      yield* Effect.promise(() => repointed.promise);
      yield* Queue.offer(upstreamOutbox, { t: "meta", pageId: "page-1" });
      expect(handoff.manages(threadId, tabId)).toBe(true);

      first.socket.close();
      yield* Effect.promise(() => first.closed);
      yield* Effect.promise(() =>
        stream.next((m) => m.type === "control" && m.controller === "agent"),
      );
      expect(upstreamInputs.filter((m) => m.kind === "insertText")).toEqual([]);

      const second = yield* lease("operator");
      yield* Effect.promise(() => second.next((m) => m.type === "viewer"));
      second.socket.send(BETTERWRIGHT_VIEWER_FALLBACK_COMPLETE_MESSAGE);
      expect(yield* Effect.promise(() => closedWith(second))).toMatchObject({ code: 4410 });
      expect((yield* Fiber.join(request)).outcome).toBe("completed");
      expect(handoff.manages(threadId, tabId)).toBe(false);
      for (const close of closes) expect(close.reason).not.toContain(TOKEN);
    }).pipe(
      Effect.provide(
        Handoff.layer.pipe(
          Layer.provideMerge(Manager.layer),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-handoff-ssh-fallback-" }),
          ),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
);
