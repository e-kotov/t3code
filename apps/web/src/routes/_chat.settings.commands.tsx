import { createFileRoute } from "@tanstack/react-router";
import { UtilitiesSettings } from "../deviceUtilities/UtilitiesPanel";

export const Route = createFileRoute("/_chat/settings/commands")({ component: UtilitiesSettings });
