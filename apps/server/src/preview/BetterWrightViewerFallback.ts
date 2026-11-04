import {
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  BETTERWRIGHT_VIEWER_FALLBACK_PATH,
  BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH,
  BetterWrightViewerFallbackCloseCode,
  type BetterWrightViewerLease,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Socket from "effect/socket/Socket";

import { authenticateMediaRequest } from "../auth/http.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { requestUrl } from "../requestUrl.ts";
import * as BetterWrightHandoff from "./BetterWrightHandoff.ts";

const textDecoder = new TextDecoder();
const MAX_ID_LENGTH = 256;
const validId = (value: string) => value.length > 0 && value.length <= MAX_ID_LENGTH;

const isComplete = (chunk: Uint8Array | string) => {
  try {
    const message: unknown = JSON.parse(
      typeof chunk === "string" ? chunk : textDecoder.decode(chunk),
    );
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "complete"
    );
  } catch {
    return false;
  }
};

// Request middleware owns tracing, including this long-lived lease socket.
const makeHandler = Effect.fnUntraced(function* (
  handoff: BetterWrightHandoff.BetterWrightHandoff["Service"],
  serverEnvironment: ServerEnvironment.ServerEnvironment["Service"],
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = requestUrl(request);
  if (
    Option.isNone(url) ||
    url.value.pathname !== BETTERWRIGHT_VIEWER_FALLBACK_SOCKET_PATH ||
    request.headers.upgrade?.toLowerCase() !== "websocket"
  ) {
    return HttpServerResponse.text("Not Found", { status: 404 });
  }
  // Same credentials as the browser stream; a refused credential never upgrades.
  const session = yield* authenticateMediaRequest(AuthOrchestrationReadScope);
  const threadId = url.value.searchParams.get("threadId") ?? "";
  const tabId = url.value.searchParams.get("tabId") ?? "";
  const environmentId = yield* serverEnvironment.getEnvironmentId;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const socket = yield* request.upgrade;
      const writer = yield* socket.writer;
      const close = (code: number, reason: string) =>
        writer
          .write(new Socket.CloseEvent(code, reason))
          .pipe(Effect.as(HttpServerResponse.empty()));
      if (!session.scopes.includes(AuthPreviewOperateScope)) {
        return yield* close(
          BetterWrightViewerFallbackCloseCode.forbidden,
          "browser control not granted",
        );
      }
      if (!validId(threadId) || !validId(tabId)) {
        return yield* close(BetterWrightViewerFallbackCloseCode.notFound, "no browser handoff");
      }
      const lease = yield* handoff.leaseViewer({ threadId, tabId });
      if (lease._tag === "NotFound") {
        return yield* close(BetterWrightViewerFallbackCloseCode.notFound, "no browser handoff");
      }
      if (lease._tag === "Busy") {
        return yield* close(BetterWrightViewerFallbackCloseCode.busy, "page controlled elsewhere");
      }
      const message: BetterWrightViewerLease = {
        type: "viewer",
        environmentId,
        threadId,
        tabId,
        port: lease.port,
        token: lease.token,
      };
      yield* writer.write(JSON.stringify(message));
      const reader = yield* socket.reader;
      const receive = reader.pull.pipe(
        Effect.flatMap((chunks) =>
          Effect.forEach(chunks, (chunk) => (isComplete(chunk) ? lease.complete : Effect.void), {
            discard: true,
          }),
        ),
      );
      // Closing the socket ends the scope, which returns control to T3's own viewers.
      return yield* Effect.raceFirst(
        lease.finished.pipe(
          Effect.andThen(close(BetterWrightViewerFallbackCloseCode.ended, "handoff ended")),
        ),
        Effect.forever(receive),
      );
    }),
  ).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty()));
});

export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const handoff = yield* BetterWrightHandoff.BetterWrightHandoff;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    yield* router.add(
      "GET",
      `${BETTERWRIGHT_VIEWER_FALLBACK_PATH}/*`,
      makeHandler(handoff, serverEnvironment),
    );
  }),
);
