import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as SshAuth from "@t3tools/ssh/auth";
import {
  buildSshHostSpecEffect,
  resolveSshCommand,
  sshTargetLogFields,
} from "@t3tools/ssh/command";
import { SshPasswordPromptError } from "@t3tools/ssh/errors";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as DesktopSshPasswordPrompts from "../ssh/DesktopSshPasswordPrompts.ts";
import { sshForwardFailureMessage, viewerForwardSshArgs } from "./viewerFallbackPolicy.ts";

const FORWARD_READY_TIMEOUT = Duration.seconds(25);
const STDERR_TAIL_CHARS = 8_192;
const MAX_PASSWORD_PROMPTS = 2;

export class ViewerFallbackError extends Data.TaggedError("ViewerFallbackError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ViewerForward {
  readonly localPort: number;
  /** Resolves with a user-facing reason once the SSH process exits. */
  readonly exited: Effect.Effect<string>;
}

class ForwardAttemptError extends Data.TaggedError("ForwardAttemptError")<{
  readonly message: string;
  readonly stderr: string;
}> {}

// The probe sends no token: any HTTP answer proves the remote viewer port is reachable.
const waitUntilAnswering = (localPort: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    yield* client.execute(HttpClientRequest.get(`http://127.0.0.1:${localPort}/`)).pipe(
      Effect.flatMap((response) => response.text),
      Effect.timeout(Duration.seconds(2)),
      Effect.retry(Schedule.spaced(Duration.millis(250))),
    );
  });

const attemptForward = Effect.fn("desktop.betterWrightFallback.attemptForward")(function* (
  target: DesktopSshEnvironmentTarget,
  remotePort: number,
  auth: SshAuth.SshAuthOptions,
) {
  const net = yield* NetService.NetService;
  const localPort = yield* net.reserveLoopbackPort("127.0.0.1");
  const hostSpec = yield* buildSshHostSpecEffect(target);
  const environment = yield* SshAuth.buildSshChildEnvironment({
    ...(auth.authSecret === undefined ? {} : { authSecret: auth.authSecret }),
    ...(auth.interactiveAuth === undefined ? {} : { interactiveAuth: auth.interactiveAuth }),
  });
  const args = viewerForwardSshArgs(target, hostSpec, {
    localPort,
    remotePort,
    batchMode: auth.batchMode ?? "yes",
  });
  const command = yield* resolveSshCommand;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* Effect.logInfo("betterwright.fallback.forward.start", {
    ...sshTargetLogFields(target),
    localPort,
    remotePort,
  });
  // The scope that owns this child kills it when the fallback session ends.
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      env: environment,
      extendEnv: true,
      stdin: { stream: Stream.empty, endOnDone: true },
    }),
  );
  let stderrTail = "";
  yield* child.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* child.stdout.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
  const exitCode = yield* child.exitCode.pipe(Effect.map(Number), Effect.cached);
  yield* Effect.raceFirst(
    waitUntilAnswering(localPort),
    exitCode.pipe(
      Effect.flatMap(() =>
        Effect.fail(
          new ForwardAttemptError({
            message: sshForwardFailureMessage(target.alias, stderrTail),
            stderr: stderrTail,
          }),
        ),
      ),
    ),
  ).pipe(
    Effect.timeoutOrElse({
      duration: FORWARD_READY_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new ForwardAttemptError({
            message: `The browser viewer did not answer through SSH on ${target.alias}. It may have stopped, or the alias may reach a different machine than the T3 server.`,
            stderr: stderrTail,
          }),
        ),
    }),
    Effect.onError(() => child.kill({ killSignal: "SIGTERM" }).pipe(Effect.ignore)),
  );
  return {
    localPort,
    exited: exitCode.pipe(
      Effect.map(() => sshForwardFailureMessage(target.alias, stderrTail)),
      Effect.orElseSucceed(() => sshForwardFailureMessage(target.alias, stderrTail)),
    ),
  } satisfies ViewerForward;
});

/**
 * Starts `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>` with the Mac's own identity, asking
 * for a password through T3's prompt only after key authentication is refused.
 */
export const startViewerForward = Effect.fn("desktop.betterWrightFallback.startForward")(function* (
  target: DesktopSshEnvironmentTarget,
  remotePort: number,
) {
  const prompt = yield* SshAuth.SshPasswordPrompt;
  let auth: SshAuth.SshAuthOptions = prompt.isAvailable
    ? { batchMode: "yes" }
    : { batchMode: "no", interactiveAuth: true };
  for (let prompts = 0; ;) {
    const result = yield* Effect.result(attemptForward(target, remotePort, auth));
    if (result._tag === "Success") return result.success;
    const failure = result.failure;
    const stderr = failure instanceof ForwardAttemptError ? failure.stderr : "";
    const retryable =
      prompt.isAvailable &&
      prompts < MAX_PASSWORD_PROMPTS &&
      SshAuth.isSshAuthFailure(stderr) &&
      !SshAuth.isSshAgentSigningFailure(stderr);
    if (!retryable) {
      return yield* new ViewerFallbackError({
        message:
          failure instanceof ForwardAttemptError
            ? failure.message
            : `Could not start SSH to ${target.alias}.`,
        cause: failure,
      });
    }
    prompts++;
    const secret = yield* prompt
      .request({
        attempt: prompts,
        destination: target.alias.trim() || target.hostname.trim(),
        username: target.username,
        prompt: `Enter the SSH password or verification code for ${target.alias} to open the browser handoff.`,
      })
      .pipe(Effect.mapError((cause) => new ViewerFallbackError({ message: cause.message, cause })));
    if (secret === null) {
      return yield* new ViewerFallbackError({
        message: `SSH authentication cancelled for ${target.alias}.`,
      });
    }
    auth = { authSecret: secret, batchMode: "no", interactiveAuth: true };
  }
});

export const desktopPasswordPrompt = (
  prompts: DesktopSshPasswordPrompts.DesktopSshPasswordPrompts["Service"],
): SshAuth.SshPasswordPrompt["Service"] => ({
  isAvailable: true,
  request: (request) =>
    prompts.request(request).pipe(
      Effect.mapError(
        (cause) =>
          new SshPasswordPromptError({
            message: DesktopSshPasswordPrompts.isDesktopSshPasswordPromptCancellation(cause)
              ? `SSH authentication cancelled for ${request.destination}.`
              : "T3 could not ask for the SSH password.",
            cause,
          }),
      ),
    ),
});
