import type { DeviceCommandRun, DeviceCommandsBridge } from "@t3tools/contracts";
import type { IpcRenderer, IpcRendererEvent } from "electron";

import * as Channels from "./deviceCommandsChannels.ts";

export function makeDeviceCommandsBridge(ipcRenderer: IpcRenderer): DeviceCommandsBridge {
  return {
    getState: () => ipcRenderer.invoke(Channels.DEVICE_COMMANDS_GET_STATE_CHANNEL),
    save: (document) => ipcRenderer.invoke(Channels.DEVICE_COMMANDS_SAVE_CHANNEL, document),
    run: (commandId) => ipcRenderer.invoke(Channels.DEVICE_COMMANDS_RUN_CHANNEL, { commandId }),
    stop: (runId) => ipcRenderer.invoke(Channels.DEVICE_COMMANDS_STOP_CHANNEL, { runId }),
    listRuns: () => ipcRenderer.invoke(Channels.DEVICE_COMMANDS_LIST_RUNS_CHANNEL),
    onRun: (listener) => {
      const wrapped = (_event: IpcRendererEvent, run: unknown) => {
        if (typeof run !== "object" || run === null) return;
        listener(run as DeviceCommandRun);
      };
      ipcRenderer.on(Channels.DEVICE_COMMANDS_RUN_UPDATED_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(Channels.DEVICE_COMMANDS_RUN_UPDATED_CHANNEL, wrapped);
      };
    },
  };
}
