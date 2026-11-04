import type {
  BetterWrightViewerFallbackOpenInput,
  BetterWrightViewerFallbackPhase,
  BetterWrightViewerFallbackState,
  DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { type SshRouteSelection, viewerWindowUrl } from "./viewerFallbackPolicy.ts";
import { ViewerFallbackError, type ViewerForward } from "./viewerForward.ts";
import type { ViewerLease } from "./viewerLease.ts";
import type { ViewerRelay } from "./viewerRelay.ts";

export interface ViewerWindow {
  readonly closed: Effect.Effect<void>;
}

/** Each resource is acquired in the session scope, so any ending releases all of them. */
export interface ViewerFallbackDeps {
  /** Returns the lease URL to dial, rebuilt from an endpoint this device vouches for. */
  readonly authorizeLease: (
    input: BetterWrightViewerFallbackOpenInput,
  ) => Effect.Effect<string, ViewerFallbackError>;
  readonly resolveRoute: (environmentId: string) => Effect.Effect<SshRouteSelection>;
  readonly openLease: (
    url: string,
    expected: { readonly environmentId: string; readonly threadId: string; readonly tabId: string },
  ) => Effect.Effect<ViewerLease, ViewerFallbackError, Scope.Scope>;
  readonly startForward: (
    target: DesktopSshEnvironmentTarget,
    remotePort: number,
  ) => Effect.Effect<ViewerForward, ViewerFallbackError, Scope.Scope>;
  /** Serves the viewer to the window through the exact-page gate. */
  readonly startRelay: (input: {
    readonly upstreamPort: number;
    readonly token: string;
    readonly pageId: string;
  }) => Effect.Effect<ViewerRelay, ViewerFallbackError, Scope.Scope>;
  readonly openWindow: (
    url: string,
    localPort: number,
  ) => Effect.Effect<ViewerWindow, ViewerFallbackError, Scope.Scope>;
  readonly publish: (state: BetterWrightViewerFallbackState) => Effect.Effect<void>;
}

interface Session {
  state: BetterWrightViewerFallbackState;
  readonly stop: Deferred.Deferred<void>;
  complete: Effect.Effect<boolean> | null;
}

interface Outcome {
  readonly phase: BetterWrightViewerFallbackPhase;
  readonly message: string | null;
}

const isLive = (session: Session) =>
  session.state.phase === "connecting" || session.state.phase === "open";

/** Sessions run in the caller's scope: closing it (app quit) closes every viewer and tunnel. */
export const makeViewerFallbackSessions = Effect.fn("desktop.betterWrightFallback.sessions")(
  function* (deps: ViewerFallbackDeps) {
    const scope = yield* Effect.scope;
    const sessions = new Map<string, Session>();

    const update = (session: Session, outcome: Outcome) =>
      Effect.suspend(() => {
        session.state = { ...session.state, ...outcome };
        return deps.publish(session.state);
      });

    const forget = (session: Session) =>
      Effect.sync(() => {
        session.complete = null;
        sessions.delete(session.state.sessionId);
      });

    const run = (session: Session, input: BetterWrightViewerFallbackOpenInput, leaseUrl: string) =>
      Effect.scoped(
        Effect.gen(function* () {
          const route = yield* deps.resolveRoute(input.environmentId);
          if (route._tag === "Unavailable") {
            return yield* new ViewerFallbackError({ message: route.reason });
          }
          const lease = yield* deps.openLease(leaseUrl, input);
          session.complete = lease.complete;
          const leaseEnded = lease.ended.pipe(
            Effect.map(({ normal, message }): Outcome => ({
              phase: normal ? "closed" : "failed",
              message,
            })),
          );
          // The lease bounds everything after it: losing it interrupts a pending password
          // prompt, SSH start or window, and whatever was acquired is released with the scope.
          const view = Effect.gen(function* () {
            const forward = yield* deps.startForward(route.target, lease.viewer.port);
            const relay = yield* deps.startRelay({
              upstreamPort: forward.localPort,
              token: lease.viewer.token,
              pageId: lease.viewer.pageId,
            });
            const window = yield* deps.openWindow(
              viewerWindowUrl(relay.localPort, relay.windowToken),
              relay.localPort,
            );
            yield* update(session, { phase: "open", message: null });
            return yield* Effect.raceFirst(
              forward.exited.pipe(Effect.map((message): Outcome => ({ phase: "failed", message }))),
              window.closed.pipe(Effect.as<Outcome>({ phase: "closed", message: null })),
            );
          });
          return yield* Effect.raceFirst(leaseEnded, view);
        }),
      ).pipe(
        Effect.raceFirst(
          Deferred.await(session.stop).pipe(Effect.as<Outcome>({ phase: "closed", message: null })),
        ),
        Effect.catch((error) =>
          Effect.succeed<Outcome>({ phase: "failed", message: error.message }),
        ),
        // Forget first, so a listener that sees the final state never finds the session live.
        Effect.flatMap((outcome) => Effect.andThen(forget(session), update(session, outcome))),
        Effect.ensuring(forget(session)),
      );

    const open = Effect.fn("desktop.betterWrightFallback.open")(function* (
      input: BetterWrightViewerFallbackOpenInput,
    ) {
      const existing = [...sessions.values()].find(
        (session) =>
          isLive(session) &&
          session.state.environmentId === input.environmentId &&
          session.state.threadId === input.threadId &&
          session.state.tabId === input.tabId,
      );
      if (existing) return { sessionId: existing.state.sessionId };
      const leaseUrl = yield* deps.authorizeLease(input);
      const session: Session = {
        state: {
          sessionId: SecureRandom.uuidV4Unsafe(),
          environmentId: input.environmentId,
          threadId: input.threadId,
          tabId: input.tabId,
          phase: "connecting",
          message: null,
        },
        stop: yield* Deferred.make<void>(),
        complete: null,
      };
      sessions.set(session.state.sessionId, session);
      yield* deps.publish(session.state);
      yield* run(session, input, leaseUrl).pipe(Effect.forkIn(scope));
      return { sessionId: session.state.sessionId };
    });

    const complete = Effect.fn("desktop.betterWrightFallback.complete")(function* (
      sessionId: string,
    ) {
      const session = sessions.get(sessionId);
      const sent =
        session?.state.phase === "open" && session.complete ? yield* session.complete : false;
      if (!sent) {
        return yield* new ViewerFallbackError({
          message: "The SSH viewer is no longer connected to this handoff.",
        });
      }
    });

    const close = Effect.fn("desktop.betterWrightFallback.close")(function* (sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) yield* Deferred.succeed(session.stop, undefined);
    });

    const list = Effect.sync(() => [...sessions.values()].map((session) => session.state));

    return { open, complete, close, list };
  },
);
