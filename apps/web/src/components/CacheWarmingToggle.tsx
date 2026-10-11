import { AuthSettingsWriteScope, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentScope } from "../state/session";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const EXPLANATION =
  "When enabled for this environment and conversation, T3 may send a short visible, billable cache-warm turn near cache expiry.";

export function CacheWarmingEnvironmentToggle(props: { environmentId: EnvironmentId | null }) {
  if (props.environmentId === null) return null;
  return <EnvironmentToggle environmentId={props.environmentId} />;
}

function EnvironmentToggle(props: { environmentId: EnvironmentId }) {
  const enabled = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.cacheWarmingEnabled,
  );
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  return (
    <div className="flex min-h-8 items-center gap-2 px-2 text-2xs text-sidebar-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        <span className="block">Warm prompt cache</span>
        <span className="block text-3xs opacity-75">
          This server · Codex/Claude · billable turns
        </span>
      </span>
      <Switch
        size="sm"
        checked={enabled}
        disabled={!canWrite}
        aria-label="Enable prompt cache warming for this environment"
        aria-description={`${EXPLANATION} This setting is stored on the selected server.`}
        onCheckedChange={(checked) => void update({ cacheWarmingEnabled: checked })}
      />
    </div>
  );
}

export function CacheWarmingThreadToggle(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  driver?: string | null | undefined;
}) {
  const enabled = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.cacheWarmingSessions[props.threadId] === true,
  );
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const unsupportedProvider = props.driver !== "codex" && props.driver !== "claudeAgent";
  const disabled = !canWrite || unsupportedProvider;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex shrink-0 items-center" role="presentation" />}
      >
        <Switch
          size="sm"
          checked={enabled}
          disabled={disabled}
          aria-label={`${enabled ? "Disable" : "Enable"} prompt cache warming for this conversation`}
          aria-description={
            unsupportedProvider
              ? "Prompt cache warming currently supports Codex and Claude only."
              : `${EXPLANATION} This conversation's opt-in is preserved while the environment switch is off.`
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onCheckedChange={(checked) =>
            void update({ cacheWarmingSessions: { [props.threadId]: checked } })
          }
        />
        {unsupportedProvider ? (
          <span className="ml-1 text-3xs text-sidebar-muted-foreground">N/A</span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {unsupportedProvider
          ? "Prompt cache warming supports Codex and Claude only."
          : `${EXPLANATION} This conversation's opt-in stays saved while the environment switch is off.`}
      </TooltipPopup>
    </Tooltip>
  );
}
