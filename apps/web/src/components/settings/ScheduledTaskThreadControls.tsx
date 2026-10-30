import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function ScheduledTaskThreadDefaults() {
  const { scope, environments } = useSettingsScope();
  if (scope.kind === "unavailable" || environments.length === 0) return null;
  return (
    <SettingsSection title="Tasks created from chat">
      {environments.map((environment) => (
        <ScheduledTaskThreadDefault
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          connected={
            environment.connection.phase === "connected" && environment.serverConfig !== null
          }
        />
      ))}
    </SettingsSection>
  );
}

function ScheduledTaskThreadDefault({
  environmentId,
  label,
  connected,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
}) {
  const mode = useEnvironmentSettings(
    environmentId,
    (settings) => settings.scheduledTaskThreadMode,
  );
  const update = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  return (
    <SettingsRow
      title={`Default thread on ${label}`}
      description="Applies to new tasks created from chat in any project on this environment, unless the agent explicitly chooses otherwise. Existing tasks are unchanged."
      control={
        <Select
          value={mode}
          disabled={!connected || !canWrite}
          onValueChange={(value) => {
            if (value === "new-thread" || value === "current-thread")
              update({ scheduledTaskThreadMode: value });
          }}
        >
          <SelectTrigger size="sm" aria-label={`Default automation thread on ${label}`}>
            <SelectValue>
              {mode === "current-thread" ? "Current thread" : "New thread, same project"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="new-thread">New thread, same project</SelectItem>
            <SelectItem value="current-thread">Current thread</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function ScheduledTaskThreadField({
  environmentId,
  projectId,
  threadId,
  disabled,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly threadId: string;
  readonly disabled: boolean;
  readonly onChange: (threadId: string) => void;
}) {
  // Runs still post to an archived thread, so a saved one stays listed by name.
  const threads = useThreadShellsForProjectRefs(
    projectId ? [scopeProjectRef(environmentId, projectId as ProjectId)] : [],
  ).filter(
    (thread) => thread.deletedAt === null && (thread.archivedAt === null || thread.id === threadId),
  );
  const selected = threads.find((thread) => thread.id === threadId);
  const threadLabel = (thread: (typeof threads)[number]) =>
    thread.archivedAt === null ? thread.title : `${thread.title} (archived)`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="scheduled-task-thread">Thread</Label>
      <Select
        value={threadId}
        disabled={disabled}
        onValueChange={(value) => {
          if (value !== null) onChange(value);
        }}
      >
        <SelectTrigger size="sm" id="scheduled-task-thread">
          <SelectValue>
            {threadId
              ? `Continue: ${selected ? threadLabel(selected) : "Saved thread (unavailable)"}`
              : "New thread each run"}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="">New thread each run</SelectItem>
          {threadId && !selected ? (
            <SelectItem value={threadId}>Saved thread (unavailable)</SelectItem>
          ) : null}
          {threads.map((thread) => (
            <SelectItem key={thread.id} value={thread.id}>
              Continue: {threadLabel(thread)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <p className="text-xs text-muted-foreground">
        {threadId
          ? "Adds each run to this thread using its existing workspace. The workspace choice below is retained for switching back to new threads."
          : "Starts a fresh conversation in the selected project each run, using the workspace choice below. This does not copy the original chat history."}
      </p>
    </div>
  );
}
