import { useAtomValue } from "@effect/atom-react";
import { deadlineStore } from "@t3tools/client-runtime/clock";
import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  cacheWarmingState,
  hotCacheThreadIds,
  nextCacheWarmExpiry,
  resolveCodexCacheWarmAfterMinutes,
} from "@t3tools/shared/cacheHud";
import { T, Var, msg, useGT } from "gt-react";
import { useState } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { useDeadlinePassed } from "../hooks/useDeadline";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useThreadShells } from "../state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { resolveActiveThreadRouteRef } from "../threadRoutes";
import { Button } from "./ui/button";

export const CACHE_WARMING_EXPLANATION = msg(
  "Keep warm may send a short visible, billable turn near cache expiry for this conversation.",
);

type CacheThread = Pick<EnvironmentThreadShell, "id" | "cacheHud" | "archivedAt">;

/** Shared state for switching every warm conversation on one environment. */
function useEnvironmentWarming(environmentId: EnvironmentId, threads: readonly CacheThread[]) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const codexWarmAfterMinutes = resolveCodexCacheWarmAfterMinutes(serverConfig);
  // Re-sample the clock when threads or the warm interval change, as well as when the
  // next expiry deadline passes, so shortening the interval drops expired chats at once.
  const readClock = () => ({ threads, codexWarmAfterMinutes, nowMs: Date.now() });
  const [clock, setClock] = useState(readClock);
  const nextExpiry = nextCacheWarmExpiry(threads, clock.nowMs, codexWarmAfterMinutes);
  const expired = useDeadlinePassed(nextExpiry);
  if (clock.threads !== threads || clock.codexWarmAfterMinutes !== codexWarmAfterMinutes) {
    setClock(readClock);
  } else if (expired && nextExpiry !== null) {
    setClock(() => ({
      threads,
      codexWarmAfterMinutes,
      nowMs: Math.max(nextExpiry, Date.now()),
    }));
  }
  const activeIds = hotCacheThreadIds(threads, clock.nowMs, codexWarmAfterMinutes);
  const cacheWarmingSessions = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cacheWarmingSessions,
  );
  const enabled = cacheWarmingState(activeIds, cacheWarmingSessions);
  const update = useUpdateEnvironmentSettings(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const toggleAll = () => {
    const currentNow = Date.now();
    const currentIds = hotCacheThreadIds(threads, currentNow, codexWarmAfterMinutes);
    if (nextExpiry !== null && currentNow >= nextExpiry) {
      deadlineStore(nextExpiry).refresh();
    }
    if (currentIds.length === 0) return;
    const value = cacheWarmingState(currentIds, cacheWarmingSessions) !== "on";
    void update({
      cacheWarmingSessions: Object.fromEntries(currentIds.map((id) => [id, value])),
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
  const gt = useGT();
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
            ? gt(
                "Warming is enabled for some warm conversations on this machine; enable it for all",
              )
            : enabled === "on"
              ? gt("Disable warming for all warm conversations on this machine")
              : gt("Enable warming for all warm conversations on this machine")
        }
        aria-pressed={enabled === "mixed" ? "mixed" : enabled === "on"}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleAll();
        }}
      >
        {enabled === "mixed"
          ? gt("Warm: Mixed")
          : enabled === "on"
            ? gt("Warm: On")
            : gt("Warm: Off")}
      </Button>
    </span>
  );
}

function EnvironmentToggle(props: {
  environmentId: EnvironmentId;
  threads: readonly CacheThread[];
}) {
  const gt = useGT();
  const { activeIds, enabled, canWrite, toggleAll } = useEnvironmentWarming(
    props.environmentId,
    props.threads,
  );
  const isOn = enabled === "on";
  const isMixed = enabled === "mixed";
  // Name the machine: with several connected, "this server" does not say which one it is.
  const machineLabel = useEnvironment(props.environmentId)?.label ?? gt("this server");
  return (
    <div className="flex min-h-8 items-center gap-2 px-2 text-2xs text-sidebar-muted-foreground">
      <span className="min-w-0 flex-1 truncate">
        <span className="block">
          <T>Warm prompt cache</T>
        </span>
        <span className="block text-3xs opacity-75">
          <T>
            <Var>{machineLabel}</Var> · Codex/Claude · billable turns
          </T>
        </span>
      </span>
      <Button
        size="xs"
        variant={isOn ? "default" : isMixed ? "secondary" : "outline"}
        disabled={!canWrite || activeIds.length === 0}
        aria-label={
          isMixed
            ? gt(
                "Warming is enabled for some hot conversations on {machineLabel}; enable it for all",
                { machineLabel: machineLabel },
              )
            : isOn
              ? gt("Disable warming for all hot conversations on {machineLabel}", { machineLabel })
              : gt("Enable warming for all hot conversations on {machineLabel}", { machineLabel })
        }
        aria-pressed={isMixed ? "mixed" : isOn}
        onClick={toggleAll}
      >
        {isMixed ? <span aria-hidden>−</span> : null}
        {isMixed ? gt("Warm all: Mixed") : isOn ? gt("Warm all: On") : gt("Warm all: Off")}
      </Button>
    </div>
  );
}
