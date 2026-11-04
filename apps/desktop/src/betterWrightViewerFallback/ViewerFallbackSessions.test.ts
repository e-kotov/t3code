import { describe, expect, it } from "@effect/vitest";
import type { BetterWrightViewerFallbackState } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";

import type { SshRouteSelection } from "./viewerFallbackPolicy.ts";
import { makeViewerFallbackSessions, type ViewerFallbackDeps } from "./ViewerFallbackSessions.ts";
import { ViewerFallbackError } from "./viewerForward.ts";

const input = {
  environmentId: "environment-gwdg",
  threadId: "thread-1",
  tabId: "tab-1",
  leaseUrl:
    "wss://gwdg.example/api/betterwright-viewer-fallback/ws?threadId=thread-1&tabId=tab-1&wsTicket=t",
};
const target = { alias: "gwdg", hostname: "gwdg", username: null, port: null };

const setup = (options?: {
  readonly route?: "missing";
  readonly forward?: "fails" | "hangs";
  readonly window?: "deferred";
  readonly authorize?: "refuses";
}) =>
  Effect.gen(function* () {
    const log: string[] = [];
    const states = yield* Queue.unbounded<BetterWrightViewerFallbackState>();
    const leaseEnded = yield* Deferred.make<{ normal: boolean; message: string }>();
    const forwardExited = yield* Deferred.make<string>();
    const windowClosed = yield* Deferred.make<void>();
    const completions: string[] = [];
    const forwardCalled = yield* Deferred.make<void>();
    const windowRequested = yield* Deferred.make<void>();
    const windowGate = yield* Deferred.make<void>();
    const dialed: string[] = [];
    const resource = <A>(name: string, value: A) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          log.push(`open ${name}`);
          return value;
        }),
        () => Effect.sync(() => log.push(`release ${name}`)),
      );
    const deps: ViewerFallbackDeps = {
      authorizeLease: (request) =>
        options?.authorize === "refuses"
          ? Effect.fail(new ViewerFallbackError({ message: "Not this environment's connection." }))
          : Effect.succeed(`${request.leaseUrl}&vouched=1`),
      resolveRoute: () =>
        Effect.succeed<SshRouteSelection>(
          options?.route === "missing"
            ? { _tag: "Unavailable", reason: "No SSH connection saved." }
            : { _tag: "Route", target },
        ),
      openLease: (url, expected) => {
        dialed.push(url);
        return resource("lease", {
          viewer: {
            type: "viewer" as const,
            environmentId: expected.environmentId,
            threadId: expected.threadId,
            tabId: expected.tabId,
            pageId: "page-1",
            port: 39123,
            token: "secret-viewer-token-123",
          },
          ended: Deferred.await(leaseEnded),
          complete: Effect.sync(() => {
            completions.push(url);
            return true;
          }),
        });
      },
      startForward: (forwardTarget, remotePort) => {
        log.push(`forward ${forwardTarget.alias} ${remotePort}`);
        if (options?.forward === "fails")
          return Effect.fail(new ViewerFallbackError({ message: "Host key verification failed." }));
        if (options?.forward === "hangs")
          return resource("forward", null).pipe(
            Effect.tap(() => Deferred.succeed(forwardCalled, undefined)),
            Effect.andThen(Effect.never),
          );
        return resource("forward", { localPort: 41000, exited: Deferred.await(forwardExited) });
      },
      openWindow: (url, _localPort, pageId) => {
        log.push(`window ${url} ${pageId}`);
        const open = resource("window", { closed: Deferred.await(windowClosed) });
        return options?.window === "deferred"
          ? Deferred.succeed(windowRequested, undefined).pipe(
              Effect.andThen(Deferred.await(windowGate)),
              Effect.andThen(open),
            )
          : open;
      },
      publish: (state) => Queue.offer(states, state).pipe(Effect.asVoid),
    };
    const scope = yield* Scope.make();
    const sessions = yield* makeViewerFallbackSessions(deps).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    const nextPhase = (phase: BetterWrightViewerFallbackState["phase"]) =>
      Effect.gen(function* () {
        while (true) {
          const state = yield* Queue.take(states);
          if (state.phase === phase) return state;
        }
      });
    return {
      sessions,
      log,
      scope,
      nextPhase,
      leaseEnded,
      forwardExited,
      windowClosed,
      completions,
      forwardCalled,
      windowRequested,
      windowGate,
      dialed,
    };
  });

describe("SSH viewer fallback sessions", () => {
  it.effect("opens lease, tunnel and window in order, completes, and releases in reverse", () =>
    Effect.gen(function* () {
      const harness = yield* setup();
      const { sessionId } = yield* harness.sessions.open(input);
      expect((yield* harness.sessions.open(input)).sessionId).toBe(sessionId);
      yield* harness.nextPhase("open");
      expect(harness.log).toEqual([
        "open lease",
        "forward gwdg 39123",
        "open forward",
        "window http://127.0.0.1:41000/?t=secret-viewer-token-123 page-1",
        "open window",
      ]);
      yield* harness.sessions.complete(sessionId);
      // The lease dialed is the one the native authorizer returned, not the renderer's.
      expect(harness.dialed).toEqual([`${input.leaseUrl}&vouched=1`]);
      expect(harness.completions).toEqual([`${input.leaseUrl}&vouched=1`]);
      yield* Deferred.succeed(harness.leaseEnded, { normal: true, message: "The handoff ended." });
      const closed = yield* harness.nextPhase("closed");
      expect(closed.message).toBe("The handoff ended.");
      expect(harness.log.slice(-3)).toEqual(["release window", "release forward", "release lease"]);
      expect(yield* harness.sessions.list).toEqual([]);
      expect(JSON.stringify(closed)).not.toContain("secret-viewer");
      const late = yield* harness.sessions.complete(sessionId).pipe(Effect.flip);
      expect(late.message).toContain("no longer connected");
    }),
  );

  it.effect("ends everything when the window closes, the tunnel drops, or the lease drops", () =>
    Effect.gen(function* () {
      for (const ending of ["window", "forward", "lease"] as const) {
        const harness = yield* setup();
        yield* harness.sessions.open(input);
        yield* harness.nextPhase("open");
        if (ending === "window") yield* Deferred.succeed(harness.windowClosed, undefined);
        if (ending === "forward") yield* Deferred.succeed(harness.forwardExited, "SSH closed.");
        if (ending === "lease")
          yield* Deferred.succeed(harness.leaseEnded, { normal: false, message: "Dropped." });
        const final = yield* harness.nextPhase(ending === "window" ? "closed" : "failed");
        expect(final.message).toBe(
          ending === "window" ? null : ending === "forward" ? "SSH closed." : "Dropped.",
        );
        expect(harness.log.slice(-3)).toEqual([
          "release window",
          "release forward",
          "release lease",
        ]);
      }
    }),
  );

  it.effect(
    "keeps current behavior without an SSH route and releases the lease when SSH fails",
    () =>
      Effect.gen(function* () {
        const missing = yield* setup({ route: "missing" });
        yield* missing.sessions.open(input);
        expect((yield* missing.nextPhase("failed")).message).toBe("No SSH connection saved.");
        expect(missing.log).toEqual([]);

        const failing = yield* setup({ forward: "fails" });
        yield* failing.sessions.open(input);
        expect((yield* failing.nextPhase("failed")).message).toBe("Host key verification failed.");
        expect(failing.log).toEqual(["open lease", "forward gwdg 39123", "release lease"]);
      }),
  );

  it.effect("cancels a pending connection and closes every session when the app quits", () =>
    Effect.gen(function* () {
      const pending = yield* setup({ forward: "hangs" });
      const { sessionId } = yield* pending.sessions.open(input);
      yield* Deferred.await(pending.forwardCalled);
      yield* pending.sessions.close(sessionId);
      yield* pending.nextPhase("closed");
      expect(pending.log).toEqual([
        "open lease",
        "forward gwdg 39123",
        "open forward",
        "release forward",
        "release lease",
      ]);

      const quitting = yield* setup();
      yield* quitting.sessions.open(input);
      yield* quitting.nextPhase("open");
      yield* Scope.close(quitting.scope, Exit.void);
      expect(quitting.log.slice(-3)).toEqual([
        "release window",
        "release forward",
        "release lease",
      ]);
    }),
  );

  it.effect("refuses a lease the device cannot vouch for before dialing anything", () =>
    Effect.gen(function* () {
      const harness = yield* setup({ authorize: "refuses" });
      const error = yield* harness.sessions.open(input).pipe(Effect.flip);
      expect(error.message).toBe("Not this environment's connection.");
      expect(yield* harness.sessions.list).toEqual([]);
      expect(harness.dialed).toEqual([]);
      expect(harness.log).toEqual([]);
    }),
  );

  it.effect("stops a pending SSH start when the lease drops, and opens no viewer", () =>
    Effect.gen(function* () {
      const harness = yield* setup({ forward: "hangs" });
      yield* harness.sessions.open(input);
      yield* Deferred.await(harness.forwardCalled);
      yield* Deferred.succeed(harness.leaseEnded, { normal: false, message: "Dropped." });
      const final = yield* harness.nextPhase("failed");
      expect(final.message).toBe("Dropped.");
      expect(harness.log).toEqual([
        "open lease",
        "forward gwdg 39123",
        "open forward",
        "release forward",
        "release lease",
      ]);
      expect(yield* harness.sessions.list).toEqual([]);
    }),
  );

  it.effect("never opens a window that was still pending when the handoff ended", () =>
    Effect.gen(function* () {
      const harness = yield* setup({ window: "deferred" });
      yield* harness.sessions.open(input);
      yield* Deferred.await(harness.windowRequested);
      yield* Deferred.succeed(harness.leaseEnded, { normal: true, message: "The handoff ended." });
      const final = yield* harness.nextPhase("closed");
      expect(final.message).toBe("The handoff ended.");
      // Releasing the gate afterwards must not resurrect the window.
      yield* Deferred.succeed(harness.windowGate, undefined);
      expect(harness.log).toEqual([
        "open lease",
        "forward gwdg 39123",
        "open forward",
        "window http://127.0.0.1:41000/?t=secret-viewer-token-123 page-1",
        "release forward",
        "release lease",
      ]);
      expect(harness.log).not.toContain("open window");
      expect(yield* harness.sessions.list).toEqual([]);
    }),
  );
});
