import * as Electron from "electron";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";

import { isViewerNavigationAllowed, viewerPageGuardScript } from "./viewerFallbackPolicy.ts";
import type { ViewerWindow } from "./ViewerFallbackSessions.ts";
import { ViewerFallbackError } from "./viewerForward.ts";

/**
 * A sandboxed window with its own in-memory session: no preload, no permissions, no popups or
 * downloads, no navigation off the forwarded loopback origin, nothing persisted to disk, and a
 * pre-page guard that keeps the viewer on the handoff page. A lost guard closes the window.
 */
export const openViewerWindow = (url: string, localPort: number, pageId: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const window = new Electron.BrowserWindow({
          width: 1280,
          height: 860,
          title: "Browser handoff over SSH",
          autoHideMenuBar: true,
          webPreferences: {
            partition: `betterwright-ssh-${SecureRandom.uuidV4Unsafe()}`,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            spellcheck: false,
            navigateOnDragDrop: false,
          },
        });
        const { session, debugger: inspector } = window.webContents;
        session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        session.setPermissionCheckHandler(() => false);
        session.on("will-download", (event) => event.preventDefault());
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        const guard = (event: Electron.Event, target: string) => {
          if (!isViewerNavigationAllowed(target, localPort)) event.preventDefault();
        };
        window.webContents.on("will-navigate", guard);
        window.webContents.on("will-redirect", guard);
        window.webContents.on("will-attach-webview", (event) => event.preventDefault());
        window.webContents.on("devtools-opened", () => window.webContents.closeDevTools());
        const closed = new Promise<void>((resolve) => window.once("closed", () => resolve()));
        try {
          inspector.attach("1.3");
          await inspector.sendCommand("Page.enable");
          await inspector.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: viewerPageGuardScript(pageId),
          });
        } catch (cause) {
          window.destroy();
          throw cause;
        }
        inspector.once("detach", () => {
          if (!window.isDestroyed()) window.destroy();
        });
        // A failed load leaves Chromium's error page; the session still ends the window.
        void window.loadURL(url).catch(() => undefined);
        return { window, session, closed };
      },
      catch: (cause) =>
        new ViewerFallbackError({
          message: "The SSH viewer window could not be secured, so it was not opened.",
          cause,
        }),
    }),
    ({ window, session }) =>
      Effect.promise(async () => {
        if (!window.isDestroyed()) window.destroy();
        await session.clearStorageData().catch(() => undefined);
      }),
  ).pipe(Effect.map(({ closed }): ViewerWindow => ({ closed: Effect.promise(() => closed) })));
