import { useAtomValue } from "@effect/atom-react";
import { createForkThreadQuotaAtoms } from "@t3tools/client-runtime/state/fork-thread-quota";
import type { EnvironmentId, ThreadId, ForkThreadQuota as Reading } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { connectionAtomRuntime } from "../../connection/runtime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { quotaAmountText } from "./forkThreadQuotaText";
import type { ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { useQuietThreadShell } from "../../state/entities";

const readings = createForkThreadQuotaAtoms(connectionAtomRuntime);

export function ForkThreadQuota({ environmentId, threadId, usage }: { environmentId: EnvironmentId; threadId: ThreadId; usage: ThreadDetailsUsageInput }) {
  if (usage.providers.find((provider) => provider.instanceId === usage.providerInstanceId)?.driver !== "codex") return null;
  const provider = usage.providers.find((entry) => entry.instanceId === usage.providerInstanceId);
  return <CodexTaskQuota environmentId={environmentId} threadId={threadId} accountKey={JSON.stringify([provider?.instanceId, provider?.auth.workspaceId, provider?.auth.email])} />;
}

function CodexTaskQuota({ environmentId, threadId, accountKey }: { environmentId: EnvironmentId; threadId: ThreadId; accountKey: string }) {
  const thread = useQuietThreadShell({ environmentId, threadId });
  const result = useAtomValue(readings(JSON.stringify([environmentId, threadId, thread?.activeProviderThreadId, accountKey])));
  const reading = AsyncResult.getOrElse(result, (): Reading | null => null);
  if (reading?.status === "unsupported") return null;
  return (
    <ThreadDetailsSection headingId="thread-quota-heading" title="Codex task usage" showHeading={false}>
      <Tooltip>
        <TooltipTrigger render={<div tabIndex={0} className="flex min-h-6 items-center justify-between gap-3 px-2.5 text-xs" />}>
          <span className="text-muted-foreground">Codex quota used</span>
          <span className="text-end font-medium tabular-nums">{reading ? quotaAmountText(reading) : result._tag === "Failure" ? "Unavailable" : "Loading…"}</span>
        </TooltipTrigger>
        <TooltipPopup side="left" sideOffset={16}>
          <div className="flex max-w-72 flex-col gap-1">
            <span>OpenAI-reported lifetime consumption for the current Codex task and its subagents, relative to a current full allowance.</span>
            <span className="text-muted-foreground">Estimates can arrive late. This is not usage during only the current week.</span>
            {reading ? <span className="text-muted-foreground">{reading.status === "partial" ? "Partial reading. " : ""}Checked {new Date(reading.checkedAt).toLocaleString()}{reading.dataAsOf ? ` · Data as of ${new Date(reading.dataAsOf).toLocaleString()}` : ""}</span> : null}
          </div>
        </TooltipPopup>
      </Tooltip>
    </ThreadDetailsSection>
  );
}
