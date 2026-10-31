// @effect-diagnostics nodeBuiltinImport:off - Exercises child processes and both real WebSocket hops.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as Handoff from "./BetterWrightHandoff.ts";
import * as Manager from "./Manager.ts";
import * as ServerBrowser from "./ServerBrowser.ts";
import { routeLayer } from "./ServerBrowserStream.ts";

const platform = NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer));

it.live(
  "publishes the existing page, transports guarded human input, resumes on release and cleans its viewer",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-handoff-route-"))),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      const inputs: unknown[] = [];
      const inputReceived = Promise.withResolvers<void>();
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
                tabs: [
                  {
                    id: "page-1",
                    sessionId: "research",
                    streaming: true,
                    url: "https://example.com",
                    title: "Original page",
                  },
                ],
              },
            ])
              yield* writer.write(JSON.stringify(message));
            yield* writer.write(new Uint8Array([255, 216, 255, 217]));
            while (true) {
              const chunks = yield* reader.pull;
              for (const chunk of chunks) {
                const message: unknown = JSON.parse(
                  typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
                );
                inputs.push(message);
                if (
                  typeof message === "object" &&
                  message !== null &&
                  "kind" in message &&
                  message.kind === "insertText"
                )
                  inputReceived.resolve();
              }
            }
          }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty())),
        ),
      );
      const upstream = yield* Layer.build(
        HttpRouter.serve(upstreamRoutes.pipe(Layer.provide(platform)), {
          disableListenLog: true,
        }).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
      );
      const upstreamServer = Context.get(upstream, HttpServer.HttpServer);
      const upstreamPort = new URL(HttpServer.formatAddress(upstreamServer.address)).port;
      const viewerUrl = `http://127.0.0.1:${upstreamPort}/?t=private-integration-token`;
      const marker = NodePath.join(directory, "stopped");
      const script = `const fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(marker)},'stopped');process.exit(0)});console.log(${JSON.stringify(viewerUrl)});setInterval(()=>{},1000);`;
      const previousView = process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND;
      const previousRun = process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND;
      process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND = JSON.stringify([
        process.execPath,
        "-e",
        script,
        "--",
      ]);
      process.env.T3CODE_BETTERWRIGHT_RUN_COMMAND = JSON.stringify([
        process.execPath,
        "-e",
        "console.log(JSON.stringify({ok:true,result:false}))",
        "--",
      ]);
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
      const threadId = ThreadId.make("handoff-thread");
      const request = yield* handoff
        .request(threadId, {
          session: "research",
          pageId: "page-1",
          prompt: "Complete the CAPTCHA",
        })
        .pipe(Effect.forkScoped);
      const opened = yield* PubSub.take(subscription).pipe(
        Effect.raceFirst(
          Fiber.join(request).pipe(
            Effect.andThen(Effect.die(new Error("Handoff ended before publishing its browser tab."))),
          ),
        ),
      );
      expect(opened.type).toBe("opened");
      const tabId = opened.tabId;
      expect(handoff.manages(threadId, tabId)).toBe(true);
      const duplicate = yield* handoff
        .request(threadId, { session: "other", pageId: "page-2", prompt: "Another handoff" })
        .pipe(Effect.flip);
      expect(duplicate.message).toContain("already active");
      const browser = ServerBrowser.ServerBrowser.of({
        clearProfile: () => Effect.void,
        reportProfiles: () => Effect.void,
        openDownload: () => Effect.succeedNone,
        answerFileChooser: () => Effect.succeed(false),
        attachViewer: (input) =>
          handoff
            .attachViewer(input)
            .pipe(
              Effect.filterOrFail(
                (viewer) => viewer !== undefined,
                () => new ServerBrowser.ServerBrowserTabNotFoundError(input),
              ),
            ),
      });
      const routes = routeLayer.pipe(
        Layer.provide(Layer.succeed(ServerBrowser.ServerBrowser, browser)),
        Layer.provide(platform),
      );
      const serverContext = yield* Layer.build(
        HttpRouter.serve(routes, { disableListenLog: true }).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provide(
            Layer.mock(EnvironmentAuth.EnvironmentAuth, {
              authenticateWebSocketUpgrade: () =>
                Effect.succeed({
                  sessionId: AuthSessionId.make("handoff-client"),
                  subject: "handoff-client",
                  method: "bearer-access-token",
                  scopes: [AuthOrchestrationReadScope, AuthPreviewOperateScope],
                }),
            }),
          ),
        ),
      );
      const server = Context.get(serverContext, HttpServer.HttpServer);
      const origin = HttpServer.formatAddress(server.address).replace(/^http/, "ws");
      const controlled = Promise.withResolvers<void>();
      const frame = Promise.withResolvers<void>();
      const probe = Promise.withResolvers<boolean>();
      const socket = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WebSocket(`${origin}/api/preview-stream/ws?threadId=${threadId}&tabId=${tabId}`),
        ),
        (socket) => Effect.sync(() => socket.close()),
      );
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          expect([...new Uint8Array(event.data as ArrayBuffer)]).toEqual([255, 216, 255, 217]);
          frame.resolve();
          socket.send(JSON.stringify({ type: "ack" }));
          return;
        }
        const message = JSON.parse(event.data);
        if (message.type === "probe") probe.resolve(message.editable);
        if (message.type === "control" && message.controller === "you") controlled.resolve();
        if (message.type === "control" && message.controller === "agent")
          socket.send(JSON.stringify({ type: "takeControl" }));
      });
      yield* Effect.promise(() => Promise.all([controlled.promise, frame.promise]));
      socket.send(JSON.stringify({ type: "probe", x: 20, y: 20 }));
      expect(yield* Effect.promise(() => probe.promise)).toBe(false);
      socket.send(JSON.stringify({ type: "text", text: "human response" }));
      yield* Effect.promise(() => inputReceived.promise);
      socket.send(JSON.stringify({ type: "releaseControl" }));
      const result = yield* Fiber.join(request);
      expect(result.outcome).toBe("completed");
      expect(inputs).toContainEqual({ t: "input", kind: "insertText", text: "human response" });
      expect((yield* manager.list({ threadId })).sessions).toEqual([]);
      expect(handoff.manages(threadId, tabId)).toBe(false);
      expect(yield* Effect.promise(() => NodeFSP.readFile(marker, "utf8"))).toBe("stopped");
    }).pipe(
      Effect.provide(
        Handoff.layer.pipe(
          Layer.provideMerge(Manager.layer),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-handoff-integration-" }),
          ),
          Layer.provide(NodeCrypto.layer),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
);
