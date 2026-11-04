import * as Electron from "electron";
import * as Effect from "effect/Effect";

import { isViewerNavigationAllowed } from "./viewerFallbackPolicy.ts";
import type { ViewerWindow } from "./ViewerFallbackSessions.ts";

/**
 * A sandboxed window with its own in-memory session: no preload, no permissions, no popups or
 * downloads, no navigation off the forwarded loopback origin, and nothing persisted to disk.
 */
export const openViewerWindow = (url: string, localPort: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const window = new Electron.BrowserWindow({
        width: 1280,
        height: 860,
        title: "Browser handoff over SSH",
        autoHideMenuBar: true,
        webPreferences: {
          partition: `betterwright-ssh-${globalThis.crypto.randomUUID()}`,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
          navigateOnDragDrop: false,
        },
      });
      const { session } = window.webContents;
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
      const closed = new Promise<void>((resolve) => window.once("closed", () => resolve()));
      // A failed load leaves the window open with Chromium's error page; the session still ends it.
      void window.loadURL(url).catch(() => undefined);
      return { window, session, closed };
    }),
    ({ window, session }) =>
      Effect.promise(async () => {
        if (!window.isDestroyed()) window.destroy();
        await session.clearStorageData().catch(() => undefined);
      }),
  ).pipe(Effect.map(({ closed }): ViewerWindow => ({ closed: Effect.promise(() => closed) })));
