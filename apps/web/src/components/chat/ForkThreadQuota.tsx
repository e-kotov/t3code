import { T, useGT, useMessages } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import { useId } from "react";
import { createForkThreadQuotaAtoms } from "@t3tools/client-runtime/state/fork-thread-quota";
import type { EnvironmentId, ThreadId, ForkThreadQuota as Reading } from "@t3tools/contracts";
import { resolveProviderInstanceEnabled } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { connectionAtomRuntime } from "../../connection/runtime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { quotaAmountText } from "./forkThreadQuotaText";
import type { ThreadDetailsUsageInput } from "./ThreadDetailsUsage";
import { useQuietThreadProjection } from "../../state/entities";
import { useEnvironmentSettings } from "../../hooks/useSettings";

const readings = createForkThreadQuotaAtoms(connectionAtomRuntime);

export function ForkThreadQuota({
  environmentId,
  threadId,
  usage,
  isServerThread,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  usage: ThreadDetailsUsageInput;
  isServerThread: boolean;
}) {
  if (!isServerThread) return null;
  return <GrantedCodexTaskQuota environmentId={environmentId} threadId={threadId} usage={usage} />;
}

function GrantedCodexTaskQuota({
  environmentId,
  threadId,
  usage,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  usage: ThreadDetailsUsageInput;
}) {
  const projection = useQuietThreadProjection({ environmentId, threadId })?.projection;
  const native = projection?.providerThreads.find(
    (row) => row.id === projection.thread.activeProviderThreadId,
  );
  const instanceId = native?.providerInstanceId;
  const nativeTaskId = native?.nativeThreadRef?.nativeId;
  const allowed = useEnvironmentSettings(environmentId, (settings) => {
    const instance = instanceId === undefined ? undefined : settings.providerInstances[instanceId];
    return (
      instance?.driver === "codex" &&
      resolveProviderInstanceEnabled(instance) &&
      instance.usageAccess === "allowed"
    );
  });
  if (native?.driver !== "codex" || !nativeTaskId || !allowed) return null;
  const provider = usage.providers.find((entry) => entry.instanceId === instanceId);
  const nativeAccountKey = JSON.stringify([
    native.id,
    nativeTaskId,
    instanceId,
    provider?.auth.workspaceId,
    provider?.auth.email,
  ]);
  return (
    <CodexTaskQuota
      key={nativeAccountKey}
      environmentId={environmentId}
      threadId={threadId}
      nativeAccountKey={nativeAccountKey}
    />
  );
}

function CodexTaskQuota({
  environmentId,
  threadId,
  nativeAccountKey,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  nativeAccountKey: string;
}) {
  const gt = useGT();
  const messages = useMessages();
  // A grant remount must not reuse the previous grant's stale-while-revalidate reading.
  const grantMountId = useId();
  const result = useAtomValue(
    readings(JSON.stringify([environmentId, threadId, nativeAccountKey, grantMountId])),
  );
  const reading = AsyncResult.getOrElse(result, (): Reading | null => null);
  if (reading?.status === "unsupported") return null;
  return (
    <ThreadDetailsSection
      headingId="thread-quota-heading"
      title={gt("Codex task usage")}
      showHeading={false}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              tabIndex={0}
              className="flex min-h-6 items-center justify-between gap-3 px-2.5 text-xs"
            />
          }
        >
          <span className="text-muted-foreground">
            <T>Codex quota used</T>
          </span>
          <span className="text-end font-medium tabular-nums">
            {reading
              ? quotaAmountText(reading, messages)
              : result._tag === "Failure"
                ? gt("Unavailable")
                : gt("Loading…")}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="left" sideOffset={16}>
          <div className="flex max-w-72 flex-col gap-1">
            <span>
              <T>
                Percentages compare OpenAI-reported lifetime consumption for the current Codex task
                and its subagents with a current full allowance. Balance credits show debits or
                adjustments.
              </T>
            </span>
            <span className="text-muted-foreground">
              <T>Estimates can arrive late. This is not usage during only the current week.</T>
            </span>
            {reading ? (
              <span className="text-muted-foreground">
                {reading.status === "partial"
                  ? reading.dataAsOf
                    ? gt("Partial reading. Checked {checkedAt} · Data as of {dataAsOf}", {
                        checkedAt: new Date(reading.checkedAt).toLocaleString(),
                        dataAsOf: new Date(reading.dataAsOf).toLocaleString(),
                      })
                    : gt("Partial reading. Checked {checkedAt}", {
                        checkedAt: new Date(reading.checkedAt).toLocaleString(),
                      })
                  : reading.dataAsOf
                    ? gt("Checked {checkedAt} · Data as of {dataAsOf}", {
                        checkedAt: new Date(reading.checkedAt).toLocaleString(),
                        dataAsOf: new Date(reading.dataAsOf).toLocaleString(),
                      })
                    : gt("Checked {checkedAt}", {
                        checkedAt: new Date(reading.checkedAt).toLocaleString(),
                      })}
              </span>
            ) : null}
          </div>
        </TooltipPopup>
      </Tooltip>
    </ThreadDetailsSection>
  );
}
