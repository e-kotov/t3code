import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { vi } from "vite-plus/test";

const electron = vi.hoisted(() => {
  type Handler = (...args: never[]) => unknown;
  class FakeWindow {
    static instances: FakeWindow[] = [];
    readonly options: Record<string, unknown>;
    readonly handlers = new Map<string, Handler>();
    readonly sessionHandlers = new Map<string, Handler>();
    destroyed = false;
    load = Promise.withResolvers<void>();
    readonly loadURL = vi.fn(() => this.load.promise);
    readonly clearStorageData = vi.fn(async () => undefined);
    permissionRequest: Handler | null = null;
    permissionCheck: Handler | null = null;
    windowOpen: Handler | null = null;
    private closed: Array<() => void> = [];
    readonly webContents = {
      session: {
        setPermissionRequestHandler: (handler: Handler) => {
          this.permissionRequest = handler;
        },
        setPermissionCheckHandler: (handler: Handler) => {
          this.permissionCheck = handler;
        },
        on: (event: string, handler: Handler) => this.sessionHandlers.set(event, handler),
        clearStorageData: this.clearStorageData,
      },
      setWindowOpenHandler: (handler: Handler) => {
        this.windowOpen = handler;
      },
      on: (event: string, handler: Handler) => this.handlers.set(event, handler),
    };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeWindow.instances.push(this);
    }
    once(event: string, handler: () => void) {
      if (event === "closed") this.closed.push(handler);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      for (const handler of this.closed.splice(0)) handler();
    }
  }
  return { FakeWindow };
});

vi.mock("electron", () => ({ BrowserWindow: electron.FakeWindow }));

import { openViewerWindow } from "./viewerWindow.ts";

const URL = "http://127.0.0.1:42000/?t=window-token-0123";

describe("viewer window adapter", () => {
  it.effect("is created, guarded and cleaned up without waiting for its page to load", () =>
    Effect.gen(function* () {
      electron.FakeWindow.instances.length = 0;
      const scope = yield* Scope.make();
      // The load never settles here; acquisition must not depend on it.
      yield* openViewerWindow(URL, 42000).pipe(Effect.provideService(Scope.Scope, scope));
      const [window] = electron.FakeWindow.instances;
      expect(electron.FakeWindow.instances).toHaveLength(1);
      expect(window!.loadURL).toHaveBeenCalledTimes(1);
      expect(window!.loadURL).toHaveBeenCalledWith(URL);
      const preferences = window!.options.webPreferences as Record<string, unknown>;
      expect(preferences).toMatchObject({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      });
      expect(String(preferences.partition)).not.toMatch(/^persist:/);
      expect(preferences.preload).toBeUndefined();

      const granted: boolean[] = [];
      window!.permissionRequest?.(
        null as never,
        "media" as never,
        ((allowed: boolean) => granted.push(allowed)) as never,
      );
      expect(granted).toEqual([false]);
      expect(window!.permissionCheck?.()).toBe(false);
      expect(window!.windowOpen?.()).toEqual({ action: "deny" });
      for (const [event, target, blocked] of [
        ["will-navigate", "https://example.com/", true],
        ["will-redirect", "http://127.0.0.1:41000/?t=daemon", true],
        ["will-navigate", "http://127.0.0.1:42000/?t=window-token-0123&auth=failed", false],
      ] as const) {
        const preventDefault = vi.fn();
        window!.handlers.get(event)?.({ preventDefault } as never, target as never);
        expect(preventDefault, `${event} ${target}`).toHaveBeenCalledTimes(blocked ? 1 : 0);
      }
      const download = vi.fn();
      window!.sessionHandlers.get("will-download")?.({ preventDefault: download } as never);
      expect(download).toHaveBeenCalledTimes(1);

      yield* Scope.close(scope, Exit.void);
      expect(window!.destroyed).toBe(true);
      expect(window!.clearStorageData).toHaveBeenCalledTimes(1);
      // The load finishing after the session ended starts nothing new.
      window!.load.resolve();
      yield* Effect.promise(() => window!.load.promise);
      expect(window!.loadURL).toHaveBeenCalledTimes(1);
      expect(electron.FakeWindow.instances).toHaveLength(1);
    }),
  );

  it.effect("reports a window the user closed", () =>
    Effect.gen(function* () {
      electron.FakeWindow.instances.length = 0;
      const viewer = yield* openViewerWindow(URL, 42000);
      electron.FakeWindow.instances[0]!.destroy();
      yield* viewer.closed;
    }).pipe(Effect.scoped),
  );
});
