import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ServerConfig, type ServerConfig as ServerConfigType, WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Socket from "effect/socket/Socket";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import * as RpcSession from "./session.ts";

const TARGET = new PrimaryConnectionTarget({ environmentId: EnvironmentId.make("slurm-environment"), label: "Slurm", httpBaseUrl: "https://environment.example.test", wsBaseUrl: "wss://environment.example.test" });
const PREPARED: PreparedConnection = { environmentId: TARGET.environmentId, label: TARGET.label, httpBaseUrl: TARGET.httpBaseUrl, socketUrl: "wss://environment.example.test/ws?wsToken=test", httpAuthorization: null, target: TARGET };
const SERVER_CONFIG: ServerConfigType = {
  environment: {
    environmentId: TARGET.environmentId,
    label: TARGET.label,
    platform: {
      os: "darwin",
      arch: "arm64",
    },
    serverVersion: "0.0.0-test",
    capabilities: {
      repositoryIdentity: true,
      connectionProbe: true,
    },
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};


const Request = Schema.TaggedStruct("Request", { id: Schema.Union([Schema.String, Schema.Number]), tag: Schema.String, payload: Schema.Unknown });
type Request = typeof Request.Type;
const isRequest = Schema.is(Request);
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(Request));
const encodeConfig = Schema.encodeSync(ServerConfig);
type Event = { readonly data?: unknown; readonly code?: number; readonly reason?: string };

class TestSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = TestSocket.CONNECTING;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly url: string;
  private readonly requests: Queue.Queue<Request>;
  constructor(url: string, requests: Queue.Queue<Request>) { this.url = url; this.requests = requests; }
  addEventListener(type: string, listener: (event: Event) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners); }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener); }
  send(data: string) { const message: unknown = JSON.parse(data); if (isRequest(message)) Queue.offerUnsafe(this.requests, decodeRequest(data)); }
  open() { this.readyState = TestSocket.OPEN; this.emit("open", {}); }
  close(code = 1000, reason = "") { this.readyState = TestSocket.CLOSED; this.emit("close", { code, reason }); }
  serverMessage(message: unknown) { this.emit("message", { data: JSON.stringify(message) }); }
  private emit(type: string, event: Event) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

it.effect("shares the Slurm opt-in stream, preserves allocation state in late replay, and isolates non-opt-in subscriptions", () => Effect.scoped(Effect.gen(function* () {
  const requests = yield* Queue.unbounded<Request>();
  const sockets = yield* Queue.unbounded<TestSocket>();
  const socketLayer = Layer.succeed(Socket.WebSocketConstructor, (url) => {
    const socket = new TestSocket(url, requests);
    Queue.offerUnsafe(sockets, socket);
    return socket as unknown as globalThis.WebSocket;
  });
  const factory = yield* RpcSession.RpcSessionFactory.pipe(Effect.provide(RpcSession.layer({ slurmJobStatus: true }).pipe(Layer.provide(socketLayer))));
  const session = yield* factory.connect(PREPARED);
  const ready = yield* Effect.forkChild(session.ready);
  const socket = yield* Queue.take(sockets);
  socket.open();
  const initial = yield* Queue.take(requests);
  expect(initial).toMatchObject({ tag: WS_METHODS.subscribeServerConfig, payload: { slurmJobStatus: true } });
  const allocation = { jobId: "16656532", state: "running" as const, remainingSeconds: 7200, observedAt: 0, serverNow: 0 };
  socket.serverMessage({ _tag: "Chunk", requestId: initial.id, values: [{ version: 1, type: "snapshot", config: encodeConfig({ ...SERVER_CONFIG, slurmJobStatus: allocation }) }] });
  yield* Fiber.join(ready);
  const replay = yield* Effect.raceFirst(
    session.subscribeServerConfig({ slurmJobStatus: true }).pipe(Stream.runHead, Effect.map((event) => ({ replay: Option.getOrThrow(event) }))),
    Queue.take(requests).pipe(Effect.map((request) => ({ unexpectedRequest: request }))),
  );
  expect(replay).toMatchObject({ replay: { type: "snapshot", config: { slurmJobStatus: allocation } } });
  expect(yield* Queue.size(requests)).toBe(0);

  const fallback = yield* session.subscribeServerConfig({}).pipe(Stream.runHead, Effect.forkChild);
  const separate = yield* Queue.take(requests);
  expect(separate).toMatchObject({ tag: WS_METHODS.subscribeServerConfig, payload: {} });
  socket.serverMessage({ _tag: "Chunk", requestId: separate.id, values: [{ version: 1, type: "snapshot", config: encodeConfig(SERVER_CONFIG) }] });
  expect(Option.getOrThrow(yield* Fiber.join(fallback))).toMatchObject({ type: "snapshot", config: SERVER_CONFIG });
})));
