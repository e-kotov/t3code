import type { DeviceCommandIcon, DeviceCommandRun } from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleSlashIcon,
  CircleXIcon,
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
import { Spinner } from "../components/ui/spinner";
import { formatRunAge } from "./deviceCommandsFormat";

export const DEVICE_COMMAND_ICON_OPTIONS: ReadonlyArray<{
  readonly id: DeviceCommandIcon;
  readonly label: string;
  readonly Icon: LucideIcon;
}> = [
  { id: "terminal", label: "Terminal", Icon: SquareTerminalIcon },
  { id: "play", label: "Start", Icon: PlayIcon },
  { id: "stop", label: "Stop", Icon: SquareIcon },
  { id: "server", label: "Server", Icon: ServerIcon },
  { id: "refresh", label: "Refresh", Icon: RefreshCwIcon },
  { id: "power", label: "Power", Icon: PowerIcon },
  { id: "plug", label: "Connect", Icon: PlugIcon },
  { id: "wrench", label: "Repair", Icon: WrenchIcon },
];

export function DeviceCommandGlyph(props: { icon: DeviceCommandIcon; className?: string }) {
  const Icon =
    DEVICE_COMMAND_ICON_OPTIONS.find((option) => option.id === props.icon)?.Icon ??
    SquareTerminalIcon;
  return <Icon aria-hidden className={cn("size-4", props.className)} />;
}

/** Spinner while running, otherwise the outcome and how long ago it finished. */
export function DeviceCommandRunBadge(props: { run: DeviceCommandRun | undefined; now: number }) {
  const { run } = props;
  if (!run) return null;
  if (run.status === "running") {
    return <Spinner size="xs" tone="muted" aria-label="Running" />;
  }
  const Icon =
    run.status === "succeeded"
      ? CircleCheckIcon
      : run.status === "stopped"
        ? CircleSlashIcon
        : CircleXIcon;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
      <Icon
        aria-label={run.status}
        className={cn(
          "size-3.5",
          run.status === "succeeded" && "text-success-foreground",
          run.status === "failed" && "text-destructive-foreground",
        )}
      />
      {formatRunAge(run.finishedAt ?? run.startedAt, props.now)}
    </span>
  );
}
