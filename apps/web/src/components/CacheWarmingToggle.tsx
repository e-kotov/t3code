import { AuthSettingsWriteScope, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentScope } from "../state/session";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const EXPLANATION =
  "When enabled for this environment and conversation, T3 may send a short visible, billable cache-warm turn near cache expiry.";

type CacheThread = Pick<EnvironmentThreadShell, "id" | "cacheHud" | "archivedAt">;

function hotThreadIds(threads: readonly CacheThread[]): ThreadId[] {
  const now = Date.now();
  return threads
    .filter((thread) => {
      const hud = thread.cacheHud;
      return (
        thread.archivedAt === null &&
        hud &&
        (hud.driver === "codex" || hud.driver === "claudeAgent") &&
        (hud.usage.cachedInputTokens ?? 0) + (hud.usage.cacheCreationTokens ?? 0) > 0 &&
        hud.ttlMs !== undefined &&
        now - Date.parse(hud.usage.updatedAt) < hud.ttlMs
      );
    })
    .map((thread) => thread.id);
}

export function CacheWarmingEnvironmentToggle(props: {
  environmentId: EnvironmentId | null;
  threads?: readonly CacheThread[];
}) {
  if (props.environmentId === null) return null;
  return <EnvironmentToggle environmentId={props.environmentId} threads={props.threads ?? []} />;
}

function EnvironmentToggle(props: {
  environmentId: EnvironmentId;
  threads: readonly CacheThread[];
}) {
  const activeIds = hotThreadIds(props.threads);
  const enabled = useEnvironmentSettings(
    props.environmentId,
    (settings) =>
      activeIds.length > 0 && activeIds.every((id) => settings.cacheWarmingSessions[id] === true),
  );
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const toggleAll = () => {
    const value = !enabled;
    void update({
      cacheWarmingSessions: Object.fromEntries(activeIds.map((id) => [id, value])),
    });
  };
  return (
    <div className="flex min-h-8 items-center gap-2 px-2 text-2xs text-sidebar-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        <span className="block">Warm prompt cache</span>
        <span className="block text-3xs opacity-75">
          This server · Codex/Claude · billable turns
        </span>
      </span>
      <Button
        size="xs"
        variant={enabled ? "default" : "outline"}
        disabled={!canWrite || activeIds.length === 0}
        aria-label={`${enabled ? "Disable" : "Enable"} warming for all hot conversations`}
        aria-pressed={enabled}
        onClick={toggleAll}
      >
        {enabled ? "Warm all: On" : "Warm all: Off"}
      </Button>
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
        <Button
          size="xs"
          variant={enabled ? "default" : "outline"}
          className="h-6 px-2 text-[10px]"
          disabled={disabled}
          aria-label={`${enabled ? "Disable" : "Enable"} cache warming for ${props.threadId}`}
          aria-pressed={enabled}
          title={
            unsupportedProvider
              ? "Prompt cache warming currently supports Codex and Claude only."
              : EXPLANATION
          }
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void update({ cacheWarmingSessions: { [props.threadId]: !enabled } });
          }}
        >
          {enabled ? "Warm on" : "Warm off"}
        </Button>
        {unsupportedProvider ? (
          <span className="ml-1 text-3xs text-sidebar-muted-foreground">N/A</span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {unsupportedProvider ? "Prompt cache warming supports Codex and Claude only." : EXPLANATION}
      </TooltipPopup>
    </Tooltip>
  );
}
