// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - The bridge owns native process/socket callbacks.
import { randomUUID } from "node:crypto";
import { OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";

import * as PreviewManager from "./Manager.ts";
import type { ServerBrowser, ServerBrowserViewer, ServerBrowserViewerOutput } from "./ServerBrowser.ts";
import { betterWrightCommand, BetterWrightBridge, startBetterWrightViewer } from "./BetterWrightBridge.ts";

export const BrowserHandoffInput = Schema.Struct({
  session: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  pageId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  profile: Schema.optional(Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64))),
  prompt: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(1000)),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 10_000, maximum: 600_000 }))),
});
export type BrowserHandoffInput = typeof BrowserHandoffInput.Type;
export const BrowserHandoffResult = Schema.Struct({
  outcome: Schema.Literals(["completed", "cancelled", "timed-out"]),
  message: Schema.String,
});

type AttachInput = Parameters<ServerBrowser["Service"]["attachViewer"]>[0];

export class BetterWrightHandoff extends Context.Service<BetterWrightHandoff, {
  readonly request: (threadId: ThreadId, input: BrowserHandoffInput) => Effect.Effect<typeof BrowserHandoffResult.Type, OrchestratorMcpFailure>;
  readonly manages: (threadId: string, tabId: string) => boolean;
  readonly closed: (threadId: string, tabId: string) => void;
  readonly attachViewer: (input: AttachInput) => Effect.Effect<ServerBrowserViewer | undefined, never, Scope.Scope>;
}>()("t3/fork/BetterWrightHandoff") {}

export const make = Effect.gen(function* () {
  const manager = yield* PreviewManager.PreviewManager;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let busy = false;
  let active: { threadId: string; tabId: string; bridge: BetterWrightBridge } | undefined;
  const manages = (threadId: string, tabId: string) => active?.threadId === threadId && active.tabId === tabId;

  const request = Effect.fn("BetterWrightHandoff.request")(function* (threadId: ThreadId, input: BrowserHandoffInput) {
    return yield* Effect.tryPromise({
      try: async (signal) => {
        if (busy) throw new Error("A BetterWright handoff is already active on this environment; finish it first.");
        const command = betterWrightCommand(process.env.T3CODE_BETTERWRIGHT_VIEW_COMMAND);
        busy = true;
        let bridge: BetterWrightBridge | undefined;
        let viewer: Awaited<ReturnType<typeof startBetterWrightViewer>> | undefined;
        let tabId: string | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => bridge?.finish("cancelled");
        signal.addEventListener("abort", abort, { once: true });
        try {
          viewer = await startBetterWrightViewer(command, input, signal);
          bridge = new BetterWrightBridge(viewer.url, input, (url, title) => {
            if (!tabId) return;
            void runPromise(manager.reportStatus({ threadId, tabId,
              navStatus: { _tag: "Success", url, title }, canGoBack: false, canGoForward: false,
              serverControlled: true }).pipe(Effect.ignore));
          });
          timer = setTimeout(() => bridge?.finish("timed-out"), input.timeoutMs ?? 300_000);
          signal.throwIfAborted();
          const ready = await Promise.race([
            bridge.waitUntilReady().then(() => "ready" as const),
            bridge.waitUntilFinished(),
          ]);
          if (ready !== "ready") return { outcome: ready, message: "The requested browser page could not be attached. Do not continue as if the human completed it." };
          const current = bridge;
          const snapshot = await runPromise(manager.open({ threadId, runtime: "server", reveal: true,
            beforePublish: (snapshot) => { active = { threadId, tabId: snapshot.tabId, bridge: current }; },
          }));
          tabId = snapshot.tabId;
          await runPromise(manager.markHeadless({ threadId, tabId }));
          await runPromise(manager.reportStatus({ threadId, tabId,
            navStatus: { _tag: "Success", url: "about:blank", title: input.prompt },
            canGoBack: false, canGoForward: false, serverControlled: true }));
          const outcome = await bridge.waitUntilFinished();
          return { outcome, message: outcome === "completed"
            ? "The human released browser control. Reinspect the original BetterWright page in the same session before continuing; this does not establish CAPTCHA or login success."
            : "Browser handoff ended without completion. Do not assume the CAPTCHA or login succeeded." };
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          bridge?.finish("cancelled");
          try {
            if (tabId) await runPromise(manager.close({ threadId, tabId }).pipe(Effect.ignore));
            await viewer?.stop();
          } finally {
            active = undefined;
            busy = false;
          }
        }
      },
      catch: (cause) => new OrchestratorMcpFailure({ code: "invalid_request", message: cause instanceof Error ? cause.message : "Browser handoff failed." }),
    });
  });

  const attachViewer = Effect.fn("BetterWrightHandoff.attachViewer")(function* (input: AttachInput) {
    if (!manages(input.threadId, input.tabId)) return undefined;
    const bridge = active!.bridge;
    const output = yield* Queue.make<ServerBrowserViewerOutput>({ capacity: 64, strategy: "dropping" });
    const runFork = Effect.runForkWith(yield* Effect.context<never>());
    const id = randomUUID();
    const detach = bridge.attach(id, { canOperate: input.canOperate, push: (value) => {
      runFork(Queue.offer(output, value._tag === "frame" ? { ...value, ack: Effect.void } : value));
    } });
    yield* Effect.addFinalizer(() => Effect.sync(detach));
    return { output, input: (message: unknown) => Effect.sync(() => bridge.input(id, message)) };
  });

  yield* Effect.addFinalizer(() => Effect.sync(() => active?.bridge.finish("cancelled")));
  return BetterWrightHandoff.of({ request, manages, attachViewer,
    closed: (threadId, tabId) => { if (manages(threadId, tabId)) active?.bridge.finish("cancelled"); },
  });
});

export const layer = Layer.effect(BetterWrightHandoff, make);
