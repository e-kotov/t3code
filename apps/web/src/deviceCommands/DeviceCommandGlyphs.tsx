import { msg } from "gt-react";
import type { DeviceCommandIcon } from "@t3tools/contracts";
import {
  PlayIcon,
  PlugIcon,
  PowerIcon,
  RefreshCwIcon,
  ServerIcon,
  SquareIcon,
  SquareTerminalIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../lib/utils";

export const DEVICE_COMMAND_ICON_OPTIONS: ReadonlyArray<{
  readonly id: DeviceCommandIcon;
  readonly label: string;
  readonly Icon: LucideIcon;
}> = [
  { id: "terminal", label: msg("Terminal"), Icon: SquareTerminalIcon },
  { id: "play", label: msg("Start"), Icon: PlayIcon },
  { id: "stop", label: msg("Stop"), Icon: SquareIcon },
  { id: "server", label: msg("Server"), Icon: ServerIcon },
  { id: "refresh", label: msg("Refresh"), Icon: RefreshCwIcon },
  { id: "power", label: msg("Power"), Icon: PowerIcon },
  { id: "plug", label: msg("Connect"), Icon: PlugIcon },
  { id: "wrench", label: msg("Repair"), Icon: WrenchIcon },
];

export function DeviceCommandGlyph(props: { icon: DeviceCommandIcon; className?: string }) {
  const Icon =
    DEVICE_COMMAND_ICON_OPTIONS.find((option) => option.id === props.icon)?.Icon ??
    SquareTerminalIcon;
  return <Icon aria-hidden className={cn("size-4", props.className)} />;
}
