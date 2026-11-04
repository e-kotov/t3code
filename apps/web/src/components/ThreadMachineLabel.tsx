import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";
import { BotIcon, CircleDashedIcon } from "lucide-react";

import { useEnvironment } from "~/state/environments";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";

export function ThreadMachineLabel(props: {
  readonly environmentId: EnvironmentId;
  readonly shell: Pick<EnvironmentThreadShell, "lineage"> | null;
}) {
  const environment = useEnvironment(props.environmentId);
  const label = environment?.label.trim() || "Unknown machine";
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-[0.2em] rounded-sm px-0.5 [:is(button:enabled,a):hover>&]:bg-foreground/10">
        {environment ? (
          <EnvironmentMachineIcon kind={resolveEnvironmentMachineKind(environment.serverConfig)} />
        ) : (
          <CircleDashedIcon />
        )}
        <span className="max-w-32 shrink-0 self-baseline truncate [:is(button:enabled,a):hover>&]:underline">
          {label}
        </span>
      </span>
      <span className="shrink-0 self-baseline"> · </span>
      {props.shell?.lineage.relationshipToParent === "subagent" ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 self-baseline text-muted-foreground">
          <BotIcon aria-hidden="true" />
          <span>Subagent</span>
        </span>
      ) : null}
    </>
  );
}

export function ThreadMachineDetails(props: { readonly environmentId: EnvironmentId }) {
  const environment = useEnvironment(props.environmentId);
  const label = environment?.label.trim();
  return (
    <div>
      <div>{label || "Unknown machine"}</div>
      {!label ? <div className="font-mono">{props.environmentId}</div> : null}
    </div>
  );
}
