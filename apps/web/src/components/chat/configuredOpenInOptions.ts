import { SquareTerminalIcon } from "lucide-react";
import type { Icon } from "../Icons";
import type { configuredEditorEntries } from "../../forkEditorPreferences";
import type { EditorId } from "@t3tools/contracts";

export function configuredOpenInOptions(
  entries: ReturnType<typeof configuredEditorEntries>,
  builtInOptions: readonly {
    value: EditorId;
    label: string;
    Icon: Icon;
    kind: "brand" | "generic";
  }[],
) {
  return entries.flatMap((entry) => {
    if (entry.builtIn) {
      const option = builtInOptions.find((value) => value.value === entry.builtIn);
      return option ? [{ ...option, value: entry.id }] : [];
    }
    return [
      {
        value: entry.id,
        label: entry.name,
        Icon: SquareTerminalIcon as Icon,
        kind: "generic" as const,
      },
    ];
  });
}
