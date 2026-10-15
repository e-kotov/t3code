import { createFileRoute } from "@tanstack/react-router";
import { DeviceCommandsSettings } from "../deviceCommands/DeviceCommandsSettings";

export const Route = createFileRoute("/settings/commands")({ component: DeviceCommandsSettings });
