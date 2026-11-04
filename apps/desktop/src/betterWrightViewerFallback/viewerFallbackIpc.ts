import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
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
import * as DesktopSshEnvironment from "../ssh/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "../ssh/DesktopSshPasswordPrompts.ts";
import * as Channels from "./viewerFallbackChannels.ts";
import {
  authorizeLeaseUrl,
  leaseEndpoints,
  selectSshRoute,
  type SshRouteSelection,
} from "./viewerFallbackPolicy.ts";
import { makeViewerFallbackSessions } from "./ViewerFallbackSessions.ts";
import { desktopPasswordPrompt, startViewerForward, ViewerFallbackError } from "./viewerForward.ts";
import { openViewerLease } from "./viewerLease.ts";
import { startViewerRelay } from "./viewerRelay.ts";
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
    const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
    const runtime = yield* Effect.context<
      NetService.NetService | HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
    >();
    // Read optionally so app wiring that never opens a viewer needs no process spawner.
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
    const passwordPrompt = SshAuth.SshPasswordPrompt.of(desktopPasswordPrompt(prompts));

    const readCatalog = catalogStore.get.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(EMPTY_CONNECTION_CATALOG_DOCUMENT),
          onSome: (raw) => decodeCatalog(raw),
        }),
      ),
      Effect.option,
    );

    // The SSH host always comes from this device's saved connection, never from the renderer.
    const resolveRoute = (environmentId: string) =>
      readCatalog.pipe(
        Effect.map(
          Option.match({
            onNone: (): SshRouteSelection => ({
              _tag: "Unavailable",
              reason: "Saved connections could not be read on this device.",
            }),
            onSome: (document) => selectSshRoute(document, environmentId),
          }),
        ),
      );

    // The lease endpoint is one this device vouches for; the renderer only names it.
    const authorizeLease = Effect.fn("desktop.betterWrightFallback.authorizeLease")(function* (
      input: BetterWrightViewerFallbackOpenInput,
    ) {
      const document = yield* readCatalog;
      if (Option.isNone(document)) {
        return yield* new ViewerFallbackError({
          message: "Saved connections could not be read on this device.",
        });
      }
      const tunnels = yield* sshEnvironment.activeEndpoints;
      const decision = authorizeLeaseUrl(
        input.leaseUrl,
        input,
        leaseEndpoints(document.value, input.environmentId, tunnels),
      );
      if (decision._tag === "Refused") {
        return yield* new ViewerFallbackError({ message: decision.message });
      }
      return decision.url;
    });

    const sessions = yield* makeViewerFallbackSessions({
      authorizeLease,
      resolveRoute,
      openLease: (url, expected) => openViewerLease(url, expected),
      startForward: (target, remotePort) =>
        Option.match(spawner, {
          onNone: () =>
            Effect.fail(new ViewerFallbackError({ message: "SSH is not available in this app." })),
          onSome: (service) =>
            startViewerForward(target, remotePort).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, service),
              Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
              Effect.provideContext(runtime),
            ),
        }),
      startRelay: (relay) => startViewerRelay(relay).pipe(Effect.provideContext(runtime)),
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
