import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";
import { CircleDashedIcon } from "lucide-react";

import { useEnvironment } from "~/state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";

export function ThreadMachineLabel(props: { readonly environmentId: EnvironmentId }) {
  const environment = useEnvironment(props.environmentId);
  const label = environment?.label.trim() || "Unknown machine";
  return (
    <>
      {environment ? (
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
        />
      ) : (
        <CircleDashedIcon />
      )}
      <span className="max-w-32 shrink-0 self-baseline truncate">{label}</span>
      <span className="shrink-0 self-baseline"> · </span>
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
