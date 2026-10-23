import { useEffect, useState } from "react";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type OrchestrationV2CacheHud,
  type ThreadId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { cacheWarmingState, hotCacheThreadIds } from "@t3tools/shared/cacheHud";
import { ThreadCachePolicyControl } from "./ThreadCachePolicyControl";
import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useThreadShells } from "../state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { resolveActiveThreadRouteRef } from "../threadRoutes";
import { Button } from "./ui/button";

export const CACHE_WARMING_EXPLANATION =
  "When enabled for this environment and conversation, T3 may send a short visible, billable cache-warm turn near cache expiry.";

type CacheThread = Pick<EnvironmentThreadShell, "id" | "cacheHud" | "archivedAt">;

/** Shared state for switching every warm conversation on one environment. */
function useEnvironmentWarming(environmentId: EnvironmentId, threads: readonly CacheThread[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const nextExpiry = threads
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
  }, [now, threads]);
  const activeIds = hotCacheThreadIds(threads, now);
  const enabled = useEnvironmentSettings(environmentId, (settings) =>
    cacheWarmingState(activeIds, settings.cacheWarmingSessions),
  );
  const update = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const toggleAll = () => {
    const value = enabled !== "on";
    void update({
      cacheWarmingSessions: Object.fromEntries(activeIds.map((id) => [id, value])),
    });
  };
  return { activeIds, enabled, canWrite, toggleAll };
}

/** Sidebar switch for the routed thread's environment, or the primary one off a thread. */
export function SidebarCacheWarmingToggle() {
  const routeTarget = useThreadRouteTarget();
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useThreadShells();
  const environmentId =
    resolveActiveThreadRouteRef(routeTarget, routeDraftThread)?.environmentId ??
    primaryEnvironmentId;
  if (environmentId === null) return null;
  return (
    <EnvironmentToggle
      environmentId={environmentId}
      threads={threads.filter((thread) => thread.environmentId === environmentId)}
    />
  );
}

/** Machine-group header button: warms or cools every warm conversation on that machine.
 * Hidden while the machine has none, like the per-conversation button. */
export function CacheWarmingMachineToggle(props: {
  environmentId: EnvironmentId;
  /** All sidebar threads; only this machine's are considered. */
  threads: readonly (CacheThread & Pick<EnvironmentThreadShell, "environmentId">)[];
}) {
  const machineThreads = props.threads.filter(
    (thread) => thread.environmentId === props.environmentId,
  );
  const { activeIds, enabled, canWrite, toggleAll } = useEnvironmentWarming(
    props.environmentId,
    machineThreads,
  );
  if (activeIds.length === 0) return null;
  return (
    // The header is uppercase and tracked; keep the button's own lettering.
    <span className="flex shrink-0 normal-case tracking-normal">
      <Button
        size="micro"
        variant={enabled === "on" ? "default" : enabled === "mixed" ? "secondary" : "outline"}
        disabled={!canWrite}
        aria-label={
          enabled === "mixed"
            ? "Warming is enabled for some warm conversations on this machine; enable it for all"
            : `${enabled === "on" ? "Disable" : "Enable"} warming for all warm conversations on this machine`
        }
        aria-pressed={enabled === "mixed" ? "mixed" : enabled === "on"}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleAll();
        }}
      >
        {enabled === "mixed" ? "Warm: Mixed" : enabled === "on" ? "Warm: On" : "Warm: Off"}
      </Button>
    </span>
  );
}

function EnvironmentToggle(props: {
  environmentId: EnvironmentId;
  threads: readonly CacheThread[];
}) {
  const { activeIds, enabled, canWrite, toggleAll } = useEnvironmentWarming(
    props.environmentId,
    props.threads,
  );
  const isOn = enabled === "on";
  const isMixed = enabled === "mixed";
  // Name the machine: with several connected, "this server" does not say which one it is.
  const machineLabel = useEnvironment(props.environmentId)?.label ?? "this server";
  return (
    <div className="flex min-h-8 items-center gap-2 px-2 text-2xs text-sidebar-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        <span className="block">Warm prompt cache</span>
        <span className="block text-3xs opacity-75">
          {machineLabel} · Codex/Claude · billable turns
        </span>
      </span>
      <Button
        size="xs"
        variant={isOn ? "default" : isMixed ? "secondary" : "outline"}
        disabled={!canWrite || activeIds.length === 0}
        aria-label={
          isMixed
            ? `Warming is enabled for some hot conversations on ${machineLabel}; enable it for all`
            : `${isOn ? "Disable" : "Enable"} warming for all hot conversations on ${machineLabel}`
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
  return <ThreadCachePolicyControl environmentId={props.environmentId} threadId={props.threadId} driver={props.driver} />;
}
