import { useEffect, useState } from "react";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type OrchestrationV2CacheHud,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useCacheHudView } from "./chat/CacheHud";
import { useEnvironmentScope } from "../state/session";
import { Button } from "./ui/button";

export const CACHE_WARMING_EXPLANATION =
  "When enabled for this environment and conversation, T3 may send a short visible, billable cache-warm turn near cache expiry.";

type CacheThread = Pick<EnvironmentThreadShell, "id" | "cacheHud" | "archivedAt">;

function hotThreadIds(threads: readonly CacheThread[], now: number): ThreadId[] {
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const nextExpiry = props.threads
      .flatMap((thread) => {
        const hud = thread.cacheHud;
        if (
          thread.archivedAt !== null ||
          !hud ||
          (hud.driver !== "codex" && hud.driver !== "claudeAgent") ||
          (hud.usage.cachedInputTokens ?? 0) + (hud.usage.cacheCreationTokens ?? 0) <= 0 ||
          hud.ttlMs === undefined
        )
          return [];
        const expiry = Date.parse(hud.usage.updatedAt) + hud.ttlMs;
        return Number.isFinite(expiry) && expiry > now ? [expiry] : [];
      })
      .reduce<number | null>(
        (earliest, expiry) => (earliest === null || expiry < earliest ? expiry : earliest),
        null,
      );
    if (nextExpiry === null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(nextExpiry - now + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [now, props.threads]);
  const activeIds = hotThreadIds(props.threads, now);
  const enabled = useEnvironmentSettings(props.environmentId, (settings) => {
    const enabledCount = activeIds.filter(
      (id) => settings.cacheWarmingSessions[id] === true,
    ).length;
    if (enabledCount === 0) return "off" as const;
    return enabledCount === activeIds.length ? ("on" as const) : ("mixed" as const);
  });
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const toggleAll = () => {
    const value = enabled !== "on";
    void update({
      cacheWarmingSessions: Object.fromEntries(activeIds.map((id) => [id, value])),
    });
  };
  const isOn = enabled === "on";
  const isMixed = enabled === "mixed";
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
        variant={isOn ? "default" : isMixed ? "secondary" : "outline"}
        disabled={!canWrite || activeIds.length === 0}
        aria-label={
          isMixed
            ? "Warming is enabled for some hot conversations; enable it for all"
            : `${isOn ? "Disable" : "Enable"} warming for all hot conversations`
        }
        aria-pressed={isMixed ? "mixed" : isOn}
        onClick={toggleAll}
      >
        {isMixed ? <span aria-hidden>−</span> : null}
        {isMixed ? "Warm all: Mixed" : isOn ? "Warm all: On" : "Warm all: Off"}
      </Button>
    </div>
  );
}

export function CacheWarmingThreadToggle(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  driver?: string | null | undefined;
  cacheHud?: OrchestrationV2CacheHud | null | undefined;
}) {
  const enabled = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.cacheWarmingSessions[props.threadId] === true,
  );
  const update = useUpdateEnvironmentSettings(props.environmentId);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const unsupportedProvider = props.driver !== "codex" && props.driver !== "claudeAgent";
  const cacheView = useCacheHudView(props.cacheHud);
  if (unsupportedProvider || (cacheView?.state !== "hot" && cacheView?.state !== "expiring"))
    return null;
  return (
    <Button
      size="micro"
      variant={enabled ? "default" : "outline"}
      disabled={!canWrite}
      aria-label={`${enabled ? "Disable" : "Enable"} cache warming for ${props.threadId}`}
      aria-pressed={enabled}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void update({ cacheWarmingSessions: { [props.threadId]: !enabled } });
      }}
    >
      {enabled ? "Warm on" : "Warm off"}
    </Button>
  );
}
