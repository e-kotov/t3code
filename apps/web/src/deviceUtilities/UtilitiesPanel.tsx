import {
  utilityServiceObservation,
  utilityTime,
  type UtilityService,
  type UtilitySnapshot,
  type UtilityAction,
} from "@t3tools/contracts";
import { ChevronRightIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";
import { DeviceCommandsSettings } from "../deviceCommands/DeviceCommandsSettings";
import { DeviceCommandOutputDialog } from "../deviceCommands/DeviceCommandOutputDialog";
import {
  ensureDeviceCommandsLoaded,
  runDeviceCommand,
  useDeviceCommandsStore,
} from "../deviceCommands/deviceCommandsStore";
import { ensureLocalApi } from "../localApi";
import {
  checkUtilities,
  getUtilitiesBridge,
  refreshUtilities,
  reloadUtilities,
  useDeviceUtilities,
  useUtilitiesStore,
} from "./utilitiesStore";

const statusClass = (status: string) =>
  status === "healthy"
    ? "text-success-foreground"
    : status === "down"
      ? "text-destructive-foreground"
      : status === "mixed" || status === "warning"
        ? "text-warning-foreground"
        : "text-muted-foreground";
function Status({ status }: { status: string }) {
  return (
    <span className={`text-xs capitalize ${statusClass(status)}`}>
      {status === "unknown" || status === "stale" ? "?" : "●"} {status}
    </span>
  );
}
async function runAction(
  snapshot: UtilitySnapshot,
  service: UtilityService,
  action: UtilityAction,
) {
  const bridge = getUtilitiesBridge();
  if (!bridge) return;
  if (action.confirm || action.scope === "shared") {
    const yes = await ensureLocalApi().dialogs.confirm(
      `${action.name}?\nRun on this device → ${service.target}\nAffects: ${action.scope === "shared" ? "shared service (other devices may be affected)" : "this device"}\n${action.command}`,
    );
    if (!yes) return;
  }
  try {
    await bridge.action(service.id, action.id, snapshot.revision);
    await refreshUtilities();
  } catch (cause) {
    useUtilitiesStore.setState({ error: String(cause) });
  }
}
function ServiceRow({
  service,
  snapshot,
  now,
}: {
  service: UtilityService;
  snapshot: UtilitySnapshot;
  now: number;
}) {
  const observed = utilityServiceObservation(snapshot, service, now);
  const run = snapshot.checks.find((r) => r.serviceId === service.id);
  const actionRun = snapshot.actions.find((r) => r.serviceId === service.id);
  return (
    <details className="group border-t py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{service.name}</span>
          <span className="block text-xs text-muted-foreground">{service.target}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Status status={observed.status} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Details <ChevronRightIcon className="size-3 group-open:rotate-90" />
          </span>
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-xs">
        <p>{observed.reason}</p>
        <p className="text-muted-foreground">
          Last check: {run ? new Date(run.startedAt).toLocaleString() : "Never"}
        </p>
        <dl className="space-y-2">
          <div>
            <dt className="text-muted-foreground">Last started</dt>
            <dd>{utilityTime(observed.result?.startedAt ?? null, now)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last restarted</dt>
            <dd>{utilityTime(observed.result?.lastRestartedAt ?? null, now)}</dd>
          </div>
        </dl>
        {observed.result?.checks.map((check) => (
          <div key={check.id} className="space-y-1">
            <div className="flex justify-between gap-2">
              <span>
                {check.name}
                {!check.required ? " · advisory" : ""}
              </span>
              <Status status={check.status} />
            </div>
            <p className="text-muted-foreground">{check.summary}</p>
          </div>
        ))}
        {service.enabled ? (
          <div className="flex flex-wrap gap-2">
            {service.actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="outline"
                disabled={actionRun?.finishedAt === null}
                onClick={() => void runAction(snapshot, service, action)}
              >
                {action.name}
                {action.confirm || action.scope === "shared" ? "…" : ""}
              </Button>
            ))}
          </div>
        ) : null}
        {actionRun ? (
          <p role="status">
            Action:{" "}
            {actionRun.finishedAt === null
              ? "running; awaiting fresh check"
              : (actionRun.error ??
                (actionRun.exitCode === 0
                  ? "completed; health checked separately"
                  : `failed (${actionRun.exitCode})`))}
          </p>
        ) : null}
        <details>
          <summary>Check and action output</summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono">
            {[run?.stdout, run?.stderr, actionRun?.stdout, actionRun?.stderr]
              .filter(Boolean)
              .join("\n") || "No output."}
          </pre>
        </details>
      </div>
    </details>
  );
}
function UtilitiesContent() {
  const { snapshot, error, now, statuses } = useDeviceUtilities();
  const commands = useDeviceCommandsStore((s) => s.commands);
  useEffect(() => {
    ensureDeviceCommandsLoaded();
  }, []);
  const counts = [...new Set(statuses)]
    .map((s) => `${statuses.filter((value) => value === s).length} ${s}`)
    .join(" · ");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Utilities</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void checkUtilities().catch((cause) =>
              useUtilitiesStore.setState({ error: String(cause) }),
            )
          }
        >
          Check now
        </Button>
      </div>
      {counts ? (
        <p className="text-xs text-muted-foreground" role="status">
          {counts}
        </p>
      ) : null}
      {error || snapshot?.error ? (
        <p role="alert" className="break-words text-xs">
          {error ?? snapshot?.error}
        </p>
      ) : null}
      {snapshot?.config?.services.map((service) => (
        <ServiceRow
          key={`${snapshot.revision}:${service.id}`}
          service={service}
          snapshot={snapshot}
          now={now}
        />
      ))}
      {!snapshot?.config ? (
        <p className="text-xs text-muted-foreground">
          Load your device’s dashboard configuration in Settings → Utilities.
        </p>
      ) : null}
      <div className="space-y-2 border-t pt-3">
        <h3 className="text-xs font-medium">Commands</h3>
        <div className="flex flex-wrap gap-2">
          {commands.map((command) => (
            <Button
              key={command.id}
              size="sm"
              variant="outline"
              onClick={() => void runDeviceCommand(command)}
            >
              {command.name}
            </Button>
          ))}
        </div>
        {!commands.length ? (
          <p className="text-xs text-muted-foreground">Add commands in Settings → Utilities.</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Runs on this device, using its shell and credentials.
      </p>
    </div>
  );
}
export function SidebarUtilitiesMenu() {
  const navigate = useNavigate();
  const { aggregate, statuses } = useDeviceUtilities();
  if (!getUtilitiesBridge()) return null;
  const label = `Utilities, ${aggregate}${statuses.length ? `, ${statuses.filter((s) => s === "down").length} down` : ""}`;
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover
        onOpenChange={(open) => {
          if (open) void checkUtilities();
        }}
      >
        <PopoverTrigger
          render={
            <SidebarMenuButton aria-label={label} size="icon">
              <span className="relative">
                <SquareTerminalIcon />
                <span
                  className={`absolute -right-1 -top-1 text-xs ${statusClass(aggregate)}`}
                  aria-hidden="true"
                >
                  ●
                </span>
              </span>
            </SidebarMenuButton>
          }
        />
        <PopoverPopup side="top" align="start" width="lg">
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            <UtilitiesContent />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate({ to: "/settings/commands" })}
            >
              Configure utilities…
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
      <DeviceCommandOutputDialog />
    </SidebarMenuItem>
  );
}
export function UtilitiesSettings() {
  const { snapshot, error } = useDeviceUtilities();
  return (
    <>
      <SettingsPageContainer>
        <SettingsSection title="Utilities" id="device-utilities">
          <div className="space-y-3 text-sm">
            <p>
              Dashboard configuration is managed on this device. Edit it in your dotfiles, apply it,
              then reload here.
            </p>
            <p className="break-all font-mono text-xs">
              {snapshot?.configPath ?? "~/.config/t3-utilities/dashboard.json"}
            </p>
            <Button variant="outline" onClick={() => void reloadUtilities()}>
              Reload configuration
            </Button>
            {error || snapshot?.error ? <p role="alert">{error ?? snapshot?.error}</p> : null}
            <p>
              {snapshot?.config?.services.length ?? 0} services loaded. Polling runs while the app
              is visible; expired observations become unknown. Disabled or inactive services do not
              affect overall health.
            </p>
          </div>
        </SettingsSection>
      </SettingsPageContainer>
      <DeviceCommandsSettings />
    </>
  );
}
