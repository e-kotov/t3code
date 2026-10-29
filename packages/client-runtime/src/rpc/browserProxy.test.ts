import { it } from "@effect/vitest";
import {
  BrowserProxyError,
  EnvironmentId,
  ThreadId,
  WS_METHODS,
  type ServerConfig,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { expect } from "vite-plus/test";

import * as Supervisor from "../connection/supervisor.ts";
import type { RpcSession } from "./session.ts";
import type { WsRpcProtocolClient } from "./protocol.ts";
import { RpcPermissionGuard } from "./client.ts";
import { openWithBrowserProxy } from "./browserProxy.ts";

it.effect(
  "rejects older servers before sending a proxied request and rejects wrong acknowledgements",
  () =>
    Effect.gen(function* () {
      for (const scenario of ["old", "wrong", "correct"] as const) {
        const calls: string[] = [];
        const proxyUrl = "socks5://proxy:1080";
        const snapshot = {
          threadId: "thread",
          tabId: "tab",
          proxyUrl: scenario === "correct" ? proxyUrl : undefined,
        } as PreviewSessionSnapshot;
        const client = {
          [WS_METHODS.serverGetConfig]: () =>
            Effect.succeed({
              environment: { capabilities: scenario === "old" ? {} : { browserProxy: true } },
            } as ServerConfig),
          [WS_METHODS.previewOpen]: () =>
            Effect.sync(() => {
              calls.push("open");
              return snapshot;
            }),
          [WS_METHODS.previewClose]: () =>
            Effect.sync(() => {
              calls.push("close");
            }),
        } as unknown as WsRpcProtocolClient;
        const session = yield* SubscriptionRef.make(Option.some({ client } as RpcSession));
        const supervisor = {
          target: { environmentId: EnvironmentId.make("host"), label: "Host" },
          session,
        } as Supervisor.EnvironmentSupervisor["Service"];
        const result = yield* openWithBrowserProxy({
          threadId: ThreadId.make("thread"),
          proxyUrl,
        }).pipe(
          Effect.result,
          Effect.provideService(Supervisor.EnvironmentSupervisor, supervisor),
          Effect.provideService(RpcPermissionGuard, { authorize: () => Effect.void }),
        );
        if (scenario === "correct") expect(result._tag).toBe("Success");
        else {
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(BrowserProxyError);
        }
        expect(calls).toEqual(
          scenario === "old" ? [] : scenario === "wrong" ? ["open", "close"] : ["open"],
        );
      }
    }),
);
