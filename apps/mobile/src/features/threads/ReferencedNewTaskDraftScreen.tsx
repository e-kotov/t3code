import type { ThreadContextRecord } from "@t3tools/contracts";
import { useEffect, useRef, type ComponentProps } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { NewTaskDraftScreen } from "./NewTaskDraftScreen";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { seedThreadReferenceDraft } from "./seedThreadReferenceDraft";

export function ReferencedNewTaskDraftScreen({
  referenceThread,
  ...props
}: ComponentProps<typeof NewTaskDraftScreen> & {
  readonly referenceThread?: ThreadContextRecord | undefined;
}) {
  const { draftKey } = useNewTaskFlow();
  const applied = useRef(false);
  const projectId = props.initialProjectRef?.projectId;
  useEffect(() => {
    if (applied.current || !draftKey || !referenceThread || !projectId) return;
    const result = seedThreadReferenceDraft(draftKey, referenceThread, projectId);
    if (result === "waiting") return;
    applied.current = true;
    if (result === "failed")
      Dialog.alert(
        "Could not add thread reference",
        "Remove some context from the draft and try again.",
      );
  }, [draftKey, projectId, referenceThread]);
  return <NewTaskDraftScreen {...props} />;
}
