import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { MachineGroupConnectionStatus } from "./MachineGroupConnectionStatus";
import { MachineGroupSlurmTime } from "./MachineGroupSlurmTime";

export function MachinePickerIndicators(props: { readonly environmentId: EnvironmentId; readonly selected?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <MachineGroupConnectionStatus environmentId={props.environmentId} />
      <MachineGroupSlurmTime environmentId={props.environmentId} className="ml-0 text-muted-foreground" />
      {props.selected ? <CheckIcon className="ms-auto size-4 shrink-0 text-muted-foreground/70" /> : null}
    </span>
  );
}
