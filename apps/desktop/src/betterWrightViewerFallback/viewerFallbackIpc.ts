import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import {
  type BetterWrightViewerFallbackAvailability,
  BetterWrightViewerFallbackOpenInput,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as SshAuth from "@t3tools/ssh/auth";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";

import * as DesktopConnectionCatalogStore from "../app/DesktopConnectionCatalogStore.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopSshPasswordPrompts from "../ssh/DesktopSshPasswordPrompts.ts";
import * as Channels from "./viewerFallbackChannels.ts";
import { NO_SSH_ROUTE_REASON, selectSshRoute } from "./viewerFallbackPolicy.ts";
import { makeViewerFallbackSessions } from "./ViewerFallbackSessions.ts";
import { desktopPasswordPrompt, startViewerForward } from "./viewerForward.ts";
import { openViewerLease } from "./viewerLease.ts";
import { openViewerWindow } from "./viewerWindow.ts";

const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(ConnectionCatalogDocument));

const BetterWrightViewerFallbackStateSchema = Schema.Struct({
  sessionId: Schema.String,
  environmentId: Schema.String,
  threadId: Schema.String,
  tabId: Schema.String,
  phase: Schema.Literals(["connecting", "open", "closed", "failed"]),
  message: Schema.NullOr(Schema.String),
});

const AvailabilitySchema = Schema.Union([
  Schema.Struct({ available: Schema.Literal(true), sshHost: Schema.String }),
  Schema.Struct({ available: Schema.Literal(false), reason: Schema.String }),
]);

/** Registers the fallback methods; quitting closes every viewer window, tunnel and lease. */
export const installViewerFallback = Effect.fn("desktop.ipc.betterWrightFallback.install")(
  function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const catalogStore = yield* DesktopConnectionCatalogStore.DesktopConnectionCatalogStore;
    const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
    const runtime = yield* Effect.context<
      | ChildProcessSpawner.ChildProcessSpawner
      | NetService.NetService
      | HttpClient.HttpClient
      | FileSystem.FileSystem
      | Path.Path
    >();
    const passwordPrompt = SshAuth.SshPasswordPrompt.of(desktopPasswordPrompt(prompts));

    // The SSH host always comes from this device's saved connection, never from the renderer.
    const resolveRoute = (environmentId: string) =>
      catalogStore.get.pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.succeed({ _tag: "Unavailable" as const, reason: NO_SSH_ROUTE_REASON }),
            onSome: (raw) =>
              decodeCatalog(raw).pipe(
                Effect.map((document) => selectSshRoute(document, environmentId)),
              ),
          }),
        ),
        Effect.orElseSucceed(() => ({
          _tag: "Unavailable" as const,
          reason: "Saved connections could not be read on this device.",
        })),
      );

    const sessions = yield* makeViewerFallbackSessions({
      resolveRoute,
      openLease: (url, expected) => openViewerLease(url, expected),
      startForward: (target, remotePort) =>
        startViewerForward(target, remotePort).pipe(
          Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
          Effect.provideContext(runtime),
        ),
      openWindow: openViewerWindow,
      publish: (state) =>
        electronWindow.sendAll(Channels.VIEWER_FALLBACK_STATE_CHANNEL, state).pipe(Effect.ignore),
    });

    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.VIEWER_FALLBACK_AVAILABILITY_CHANNEL,
        payload: Schema.String,
        result: AvailabilitySchema,
        handler: Effect.fn("desktop.ipc.betterWrightFallback.availability")(
          function* (environmentId) {
            const route = yield* resolveRoute(environmentId);
            return (
              route._tag === "Route"
                ? { available: true, sshHost: route.target.alias }
                : { available: false, reason: route.reason }
            ) satisfies BetterWrightViewerFallbackAvailability;
          },
        ),
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.VIEWER_FALLBACK_OPEN_CHANNEL,
        payload: BetterWrightViewerFallbackOpenInput,
        result: Schema.Struct({ sessionId: Schema.String }),
        handler: sessions.open,
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.VIEWER_FALLBACK_COMPLETE_CHANNEL,
        payload: Schema.String,
        result: Schema.Void,
        handler: sessions.complete,
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.VIEWER_FALLBACK_CLOSE_CHANNEL,
        payload: Schema.String,
        result: Schema.Void,
        handler: sessions.close,
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.VIEWER_FALLBACK_SESSIONS_CHANNEL,
        payload: Schema.Void,
        result: Schema.Array(BetterWrightViewerFallbackStateSchema),
        handler: () => sessions.list,
      }),
    );
  },
);
