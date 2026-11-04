import type {
  BetterWrightViewerFallbackBridge,
  BetterWrightViewerFallbackState,
} from "@t3tools/contracts";
import type { IpcRenderer, IpcRendererEvent } from "electron";

import * as Channels from "./viewerFallbackChannels.ts";

function makeViewerFallbackBridge(ipcRenderer: IpcRenderer): BetterWrightViewerFallbackBridge {
  return {
    availability: (environmentId) =>
      ipcRenderer.invoke(Channels.VIEWER_FALLBACK_AVAILABILITY_CHANNEL, environmentId),
    open: (input) => ipcRenderer.invoke(Channels.VIEWER_FALLBACK_OPEN_CHANNEL, input),
    complete: (sessionId) =>
      ipcRenderer.invoke(Channels.VIEWER_FALLBACK_COMPLETE_CHANNEL, sessionId),
    close: (sessionId) => ipcRenderer.invoke(Channels.VIEWER_FALLBACK_CLOSE_CHANNEL, sessionId),
    sessions: () => ipcRenderer.invoke(Channels.VIEWER_FALLBACK_SESSIONS_CHANNEL),
    onState: (listener) => {
      const wrapped = (_event: IpcRendererEvent, state: unknown) => {
        if (typeof state !== "object" || state === null) return;
        listener(state as BetterWrightViewerFallbackState);
      };
      ipcRenderer.on(Channels.VIEWER_FALLBACK_STATE_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.VIEWER_FALLBACK_STATE_CHANNEL, wrapped);
      };
    },
  };
}

/** The SSH viewer fallback relies on an OpenSSH client the Windows build does not assume. */
export const viewerFallbackBridge = (
  ipcRenderer: IpcRenderer,
  platform: string,
): { betterWrightViewerFallback?: BetterWrightViewerFallbackBridge } =>
  platform === "win32" ? {} : { betterWrightViewerFallback: makeViewerFallbackBridge(ipcRenderer) };
