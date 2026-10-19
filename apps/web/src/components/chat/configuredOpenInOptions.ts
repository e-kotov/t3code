import * as Cause from "effect/Cause";
import { SquareTerminalIcon } from "lucide-react";
import type { Icon } from "../Icons";
import { toastManager } from "../ui/toast";
import type { configuredEditorEntries } from "../../forkEditorPreferences";
import type { useConfiguredEditors } from "../../useConfiguredEditors";
import type { EditorId } from "@t3tools/contracts";

/** Picker options in configured order; `resolveBuiltIns` is the upstream platform list. */
export function configuredOpenInOptions(
  entries: ReturnType<typeof configuredEditorEntries>,
  resolveBuiltIns: (editors: EditorId[]) => readonly {
    value: EditorId;
    label: string;
    Icon: Icon;
    kind: "brand" | "generic";
  }[],
) {
  const builtInOptions = resolveBuiltIns(
    entries.flatMap((entry) => (entry.builtIn ? [entry.builtIn] : [])),
  );
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

export async function reportEditorOpenFailure(
  pending: ReturnType<ReturnType<typeof useConfiguredEditors>["open"]>,
): Promise<void> {
  const result = await pending;
  if (result._tag !== "Failure") return;
  const error = Cause.squash(result.cause);
  toastManager.add({
    type: "error",
    title: "Could not open editor",
    description: error instanceof Error ? error.message : undefined,
  });
}
