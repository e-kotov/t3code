import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { serverEnvironment } from "~/state/server";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describeCacheHud, describeUsageWindows } from "@t3tools/shared/cacheHud";
import {
  ChartPieIcon,
  DatabaseIcon,
  FlameIcon,
  GaugeIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { CACHE_WARMING_EXPLANATION } from "./CacheWarmingToggle";

/** Cache, context, warming and subscription-limit rows for a conversation's
 * sidebar hover card. Limits belong to the provider account on that machine. */
export function ThreadCacheHoverDetails(props: {
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "cacheHud">;
  usageWindows?: ReadonlyArray<ServerProviderUsageWindow> | undefined;
  providerInstanceId?: string;
}) {
  const { environmentId, id: threadId, cacheHud: hud } = props.thread;
  const warming = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cacheWarmingSessions[threadId] === true,
  );
  // The card mounts when it opens, so its times are as of opening.
  const [openedAt] = useState(() => Date.now());
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const usageWindows =
    props.usageWindows ??
    providers?.find((provider) => provider.instanceId === props.providerInstanceId)?.usageLimits
      ?.windows;
  const limits = describeUsageWindows(usageWindows, openedAt);
  if (!hud && limits.length === 0) return null;
  const details = hud ? describeCacheHud(hud, openedAt) : null;
  const supportsWarming = hud?.driver === "claudeAgent";
  return (
    <div className="grid gap-1.5 border-t border-border/60 pt-1.5" data-thread-cache-details="true">
      {details ? (
        <>
          <Row icon={TimerIcon} warning={details.state === "expiring"} label={details.cache} />
          {details.lastRequest ? <Row icon={DatabaseIcon} label={details.lastRequest} /> : null}
          {details.resume ? <Row icon={DatabaseIcon} label={details.resume} /> : null}
          <Row icon={GaugeIcon} label={details.context} />
        </>
      ) : null}
      {limits.map((limit) => (
        <Row key={limit.id} icon={ChartPieIcon} label={limit.text} />
      ))}
      {supportsWarming ? (
        <div className="flex min-w-0 items-start gap-2">
          <FlameIcon className="mt-0.5 size-3 shrink-0 stroke-muted-foreground" />
          <div className="min-w-0 flex-1 leading-4">
            <div className="text-foreground/75">{warming ? "Warming on" : "Warming off"}</div>
            <div className="text-2xs">{CACHE_WARMING_EXPLANATION}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row(props: { icon: LucideIcon; label: string; warning?: boolean }) {
  const Icon = props.icon;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", props.warning && "text-warning")}>
      <Icon
        className={cn(
          "size-3 shrink-0",
          props.warning ? "stroke-current" : "stroke-muted-foreground",
        )}
      />
      <div title={props.label} className={cn("min-w-0 truncate", !props.warning && "text-foreground/75")}>
        {props.label}
      </div>
    </div>
  );
}
