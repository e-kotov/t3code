import { useGT, useMessages, T, Var } from "gt-react";
import { useNavigate } from "@tanstack/react-router";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { resolveEnvironmentMachineKind, type ScopedThreadRef } from "@t3tools/contracts";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";

import { cn } from "../../lib/utils";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useEnvironmentPresentation } from "../../state/presentation";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { MachineGroupConnectionStatus } from "../MachineGroupConnectionStatus";
import { machineConnectionSettingsTargetId } from "../settings/machineConnectionSettingsTarget";
import { MachineGroupSlurmTime } from "../MachineGroupSlurmTime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function HeaderMachineLabel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const messages = useMessages();
  const { presentation } = useEnvironmentPresentation(threadRef.environmentId);
  const { startScratchThread } = useScratchProject();
  const navigate = useNavigate();
  const canInspectConnection =
    presentation !== null && presentation.connection.phase !== "connected";
  if (!presentation) return null;
  const label = presentation.entry.target.label;
  const status = connectionStatusText(presentation.connection, messages);
  // Like the project crumb, the machine crumb starts a thread: a projectless one in the
  // machine's scratch workspace, offered only while the machine can create it.
  const canStartThread =
    availableScratchWorkspaceRoot(presentation.connection.phase, presentation.serverConfig) !==
    null;

  return (
    <div data-header-machine className="flex shrink-0 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <MachineGroupConnectionStatus environmentId={threadRef.environmentId} />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Machine: {label}. {status}", { label: label, status: status })}
                onClick={
                  canStartThread
                    ? () => void startScratchThread(threadRef.environmentId)
                    : canInspectConnection
                      ? () =>
                          void navigate({
                            to: "/settings/connections",
                            search: { machine: threadRef.environmentId },
                            hash: machineConnectionSettingsTargetId(threadRef.environmentId),
                          })
                      : undefined
                }
                className={cn(
                  "inline-flex min-w-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  canStartThread || canInspectConnection
                    ? "cursor-pointer transition-colors hover:text-foreground"
                    : "cursor-help",
                )}
              />
            }
          >
            <EnvironmentMachineIcon
              kind={resolveEnvironmentMachineKind(presentation.serverConfig)}
              className="size-3.5 shrink-0"
              aria-hidden
            />
            <span className="hidden max-w-24 truncate @min-[28rem]/header-context:block">
              {label}
            </span>
          </TooltipTrigger>
          <TooltipPopup>
            {label}: {status}
            {canStartThread ? (
              <div>
                <T>
                  New thread on <Var>{label}</Var>
                </T>
              </div>
            ) : canInspectConnection ? (
              <div>
                <T>
                  Open connection settings for <Var>{label}</Var>
                </T>
              </div>
            ) : null}
          </TooltipPopup>
        </Tooltip>
        <MachineGroupSlurmTime
          environmentId={threadRef.environmentId}
          className="ml-0 hidden text-xs text-muted-foreground @min-[28rem]/header-context:block"
        />
      </div>
      <span aria-hidden className="shrink-0 text-sm text-icon-muted">
        /
      </span>
    </div>
  );
}
