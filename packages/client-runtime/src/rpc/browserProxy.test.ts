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
import { RpcClientError } from "effect/rpc";
import { expect } from "vite-plus/test";

import * as Supervisor from "../connection/supervisor.ts";
import type { RpcSession } from "./session.ts";
import type { WsRpcProtocolClient } from "./protocol.ts";
import { RpcPermissionGuard } from "./client.ts";
import { openWithBrowserProxy } from "./browserProxy.ts";

it.effect("checks server routes and keeps proxy failures distinct from ordinary direct opens", () =>
  Effect.gen(function* () {
    const proxyUrl = "socks5://proxy:1080";
    const transportFailure = new RpcClientError.RpcClientError({
      reason: new RpcClientError.RpcClientDefect({
        message: "Transport failed.",
        cause: new Error("Transport failed."),
      }),
    });
    const scenarios = [
      "old",
      "wrong",
      "correct",
      "implicit",
      "implicit-failed",
      "failed",
      "cleanup-failed",
      "direct",
      "disabled",
      "local",
    ] as const;
    for (const scenario of scenarios) {
      const calls: string[] = [];
      let configReads = 0;
      const implicit = scenario === "implicit" || scenario === "implicit-failed";
      const useDefault = implicit || scenario === "disabled" || scenario === "local";
      const expectedProxy =
        scenario === "direct"
          ? ""
          : scenario === "disabled" || scenario === "local"
            ? undefined
            : proxyUrl;
      const snapshot = {
        threadId: "thread",
        tabId: "tab",
        proxyUrl: scenario === "wrong" || scenario === "cleanup-failed" ? undefined : expectedProxy,
      } as PreviewSessionSnapshot;
      const client = {
        [WS_METHODS.serverGetConfig]: () =>
          Effect.sync(() => {
            configReads += 1;
            return {
              environment: { capabilities: scenario === "old" ? {} : { browserProxy: true } },
              settings: {
                browserProxy: { enabled: implicit || scenario === "local", url: proxyUrl },
              },
            } as ServerConfig;
          }),
        [WS_METHODS.previewOpen]: (input: { proxyUrl?: string }) =>
          Effect.gen(function* () {
            calls.push("open");
            expect(input.proxyUrl).toBe(expectedProxy);
            if (scenario === "failed" || scenario === "implicit-failed")
              return yield* Effect.fail(transportFailure);
            return snapshot;
          }),
        [WS_METHODS.previewClose]: () =>
          Effect.gen(function* () {
            calls.push("close");
            if (scenario === "cleanup-failed")
              return yield* Effect.fail(transportFailure);
          }),
      } as unknown as WsRpcProtocolClient;
      const session = yield* SubscriptionRef.make(Option.some({ client } as RpcSession));
      const supervisor = {
        target: { environmentId: EnvironmentId.make("host"), label: "Host" },
        session,
      } as Supervisor.EnvironmentSupervisor["Service"];
      const result = yield* openWithBrowserProxy({
        threadId: ThreadId.make("thread"),
        url: scenario === "local" ? "http://localhost:3000" : "https://example.com",
        ...(useDefault ? {} : { proxyUrl: scenario === "direct" ? "" : proxyUrl }),
      }).pipe(
        Effect.result,
        Effect.provideService(Supervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(RpcPermissionGuard, { authorize: () => Effect.void }),
      );
      if (["correct", "implicit", "direct", "disabled", "local"].some((name) => name === scenario))
        expect(result._tag).toBe("Success");
      else {
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(BrowserProxyError);
      }
      expect(calls).toEqual(
        scenario === "old"
          ? []
          : scenario === "wrong" || scenario === "cleanup-failed"
            ? ["open", "close"]
            : ["open"],
      );
      expect(configReads).toBe(scenario === "direct" || scenario === "local" ? 0 : 1);
    }
  }),
);
