import { paletteDeviceCommands } from "./deviceCommands.logic";
import { useEffect } from "react";
import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { DeviceCommandGlyph } from "./DeviceCommandGlyphs";
import {
  ensureDeviceCommandsLoaded,
  getDeviceCommandsBridge,
  runDeviceCommand,
  useDeviceCommandsStore,
} from "./deviceCommandsStore";

export function useDeviceCommandPaletteItems(): CommandPaletteActionItem[] {
  const commands = useDeviceCommandsStore((state) => state.commands);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read the desktop command file through IPC while palette commands are available.
  useEffect(() => {
    ensureDeviceCommandsLoaded();
  }, []);
  if (!getDeviceCommandsBridge()) return [];
  return paletteDeviceCommands(commands).map((command) => ({
    kind: "action",
    value: `device-command:${command.id}`,
    title: `Run: ${command.name}`,
    searchTerms: [command.name, "device command", "run"],
    icon: <DeviceCommandGlyph icon={command.icon} />,
    run: () => runDeviceCommand(command),
  }));
}
