import { resolveEnvironmentMachineKind, type EnvironmentId } from "@t3tools/contracts";

import { useEnvironment } from "~/state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";

export function ThreadMachineLabel(props: {
  readonly environmentId: EnvironmentId;
}) {
  const environment = useEnvironment(props.environmentId);
  const label = environment?.label.trim() || props.environmentId;
  return (
    <>
      <EnvironmentMachineIcon
        kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
      />
      <span className="max-w-32 shrink-0 truncate" title={label}>
        {label} ·
      </span>
    </>
  );
}
