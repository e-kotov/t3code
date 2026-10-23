import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ReactNode } from "react";

import { CACHE_WARMING_EXPLANATION, CacheWarmingThreadToggle } from "../CacheWarmingToggle";
import { ThreadCachePolicyControl } from "../ThreadCachePolicyControl";
import { CacheHud } from "../chat/CacheHud";

type CacheThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "cacheHud" | "modelSelection">;

/** The compact readout, outside any truncating title so it stays on its line. */
export function SidebarCacheHudSlot(props: { readonly hud: CacheThread["cacheHud"] }) {
  return (
    <span className="flex shrink-0">
      <CacheHud hud={props.hud} compact />
    </span>
  );
}

function ThreadWarmToggle(props: { readonly thread: CacheThread }) {
  return (
    <CacheWarmingThreadToggle
      environmentId={props.thread.environmentId}
      threadId={props.thread.id}
      driver={props.thread.cacheHud?.driver}
      cacheHud={props.thread.cacheHud}
    />
  );
}

export function SidebarThreadCacheTitle(props: {
  readonly variant: "card" | "slim";
  readonly thread: CacheThread;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={
        props.variant === "slim"
          ? "flex min-w-0 flex-1 items-center gap-1.5"
          : "flex min-w-0 flex-1 items-center gap-2"
      }
    >
      {props.children}
      {props.variant === "slim" ? <><SidebarCacheHudSlot hud={props.thread.cacheHud} /><SidebarThreadCachePolicy thread={props.thread} /></> : null}
    </span>
  );
}

/** The legacy sidebar's single-line row: readout and toggle beside the title. */
export function SidebarThreadCacheControls(props: { readonly thread: CacheThread }) {
  return (
    <>
      <SidebarCacheHudSlot hud={props.thread.cacheHud} />
      <ThreadWarmToggle thread={props.thread} />
    </>
  );
}

/** Title tooltip note for providers the warmer supports. */
export function CacheWarmingTitleHint(props: { readonly thread: CacheThread }) {
  const driver = props.thread.cacheHud?.driver;
  if (driver !== "codex" && driver !== "claudeAgent") return null;
  return (
    <span className="mt-1 block max-w-xs text-2xs text-muted-foreground">
      {CACHE_WARMING_EXPLANATION}
    </span>
  );
}

export function SidebarThreadCachePolicy(props: { readonly thread: CacheThread }) {
  return <ThreadCachePolicyControl environmentId={props.thread.environmentId} threadId={props.thread.id}
    instanceId={props.thread.modelSelection.instanceId} driver={props.thread.cacheHud?.driver} reveal />;
}
