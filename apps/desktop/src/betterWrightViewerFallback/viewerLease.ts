import {
  BETTERWRIGHT_VIEWER_FALLBACK_COMPLETE_MESSAGE,
  BetterWrightViewerFallbackCloseCode,
  type BetterWrightViewerLease,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { acceptLease, leaseClosedMessage } from "./viewerFallbackPolicy.ts";
import { ViewerFallbackError } from "./viewerForward.ts";

const LEASE_TIMEOUT = Duration.seconds(15);

export interface ViewerLease {
  readonly viewer: BetterWrightViewerLease;
  /** Resolves when the server ends the lease (`normal`) or the connection drops. */
  readonly ended: Effect.Effect<{ readonly normal: boolean; readonly message: string }>;
  readonly complete: Effect.Effect<boolean>;
}

export type MakeLeaseSocket = (url: string) => WebSocket;

/**
 * Holds the server's lease for as long as the scope is open; closing it returns control of the
 * page to T3's own viewers. The URL carries a single-use ticket and is never logged.
 */
export const openViewerLease = Effect.fn("desktop.betterWrightFallback.openLease")(function* (
  url: string,
  expected: { readonly environmentId: string; readonly threadId: string; readonly tabId: string },
  makeSocket: MakeLeaseSocket = (value) => new WebSocket(value),
) {
  // Listeners attach in the same tick as the socket, so no early close can be missed.
  const connection = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const socket = makeSocket(url);
      let opened = false;
      socket.addEventListener("open", () => {
        opened = true;
      });
      const closed = new Promise<CloseEvent>((resolve) =>
        socket.addEventListener("close", (event) => resolve(event)),
      );
      const first = new Promise<unknown>((resolve) =>
        socket.addEventListener("message", (event) => resolve(event.data), { once: true }),
      );
      return { socket, closed, first, opened: () => opened };
    }),
    ({ socket }) => Effect.sync(() => socket.close(1000)),
  );
  const outcome = yield* Effect.promise(() =>
    Promise.race([
      connection.first.then((data) => ({ _tag: "Message" as const, data })),
      connection.closed.then((event) => ({ _tag: "Closed" as const, code: event.code })),
    ]),
  ).pipe(
    Effect.timeoutOrElse({
      duration: LEASE_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new ViewerFallbackError({ message: "The T3 server did not answer the browser lease." }),
        ),
    }),
  );
  if (outcome._tag === "Closed") {
    return yield* new ViewerFallbackError({
      message: leaseClosedMessage(outcome.code, connection.opened()),
    });
  }
  const decision = acceptLease(outcome.data, expected);
  if (decision._tag === "Rejected") {
    return yield* new ViewerFallbackError({ message: decision.message });
  }
  const { socket } = connection;
  return {
    viewer: decision.lease,
    ended: Effect.promise(() => connection.closed).pipe(
      Effect.map((event) => ({
        normal: event.code === BetterWrightViewerFallbackCloseCode.ended,
        message: leaseClosedMessage(event.code, true),
      })),
    ),
    complete: Effect.sync(() => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(BETTERWRIGHT_VIEWER_FALLBACK_COMPLETE_MESSAGE);
      return true;
    }),
  } satisfies ViewerLease;
});
