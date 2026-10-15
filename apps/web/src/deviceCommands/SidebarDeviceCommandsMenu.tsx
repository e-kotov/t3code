import { useNavigate } from "@tanstack/react-router";
import { SquareTerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { DeviceCommandGlyph, DeviceCommandRunBadge } from "./DeviceCommandGlyphs";
import { DeviceCommandOutputDialog } from "./DeviceCommandOutputDialog";
import {
  ensureDeviceCommandsLoaded,
  getDeviceCommandsBridge,
  openDeviceCommandOutput,
  runDeviceCommand,
  useDeviceCommandsStore,
} from "./deviceCommandsStore";

/** Sidebar utility button listing this device's commands. Desktop app only. */
export function SidebarDeviceCommandsMenu() {
  if (!getDeviceCommandsBridge()) return null;
  return <DeviceCommandsMenu />;
}

function DeviceCommandsMenu() {
  const navigate = useNavigate();
  const commands = useDeviceCommandsStore((state) => state.commands);
  const runs = useDeviceCommandsStore((state) => state.runsByCommandId);
  const loadError = useDeviceCommandsStore((state) => state.loadError);
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = Object.values(runs).some((run) => run.status === "running");

  useEffect(() => {
    ensureDeviceCommandsLoaded();
  }, []);

  return (
    <SidebarMenuItem className="shrink-0">
      <Menu onOpenChange={(open) => open && setNow(Date.now())}>
        <MenuTrigger
          render={
            <SidebarMenuButton aria-label="Commands" size="icon">
              <span className="relative">
                <SquareTerminalIcon />
                {anyRunning ? (
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
            </SidebarMenuButton>
          }
        />
        <MenuPopup side="top" align="start" className="min-w-64">
          <MenuGroup>
            <MenuGroupLabel>Commands</MenuGroupLabel>
            {loadError ? (
              <MenuItem disabled>Could not read commands: {loadError}</MenuItem>
            ) : commands.length === 0 ? (
              <MenuItem disabled>No commands yet</MenuItem>
            ) : (
              commands.map((command) => (
                <MenuItem
                  key={command.id}
                  onClick={() =>
                    runs[command.id]
                      ? openDeviceCommandOutput(runs[command.id]!.runId)
                      : void runDeviceCommand(command)
                  }
                >
                  <DeviceCommandGlyph icon={command.icon} />
                  <span className="min-w-0 flex-1 truncate">{command.name}</span>
                  <DeviceCommandRunBadge run={runs[command.id]} now={now} />
                </MenuItem>
              ))
            )}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={() => void navigate({ to: "/settings/commands" })}>
            Edit commands…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <DeviceCommandOutputDialog />
    </SidebarMenuItem>
  );
}
