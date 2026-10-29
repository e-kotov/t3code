import type { ThreadContextRecord } from "@t3tools/contracts";
import { useEffect, useRef, type ComponentProps } from "react";
import * as Dialog from "../../components/ui/Dialog";
import { NewTaskDraftScreen } from "./NewTaskDraftScreen";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { seedBranchlessThreadWorkspace, seedThreadReferenceDraft } from "./seedThreadReferenceDraft";

export function ReferencedNewTaskDraftScreen({
  referenceThread,
  ...props
}: ComponentProps<typeof NewTaskDraftScreen> & {
  readonly referenceThread?: ThreadContextRecord | undefined;
}) {
  const { draftKey, selectedProject } = useNewTaskFlow();
  const applied = useRef(false);
  const projectId = props.initialProjectRef?.projectId;
  const environmentId = props.initialProjectRef?.environmentId;
  const branch = props.initialProjectRef?.branch;
  const worktreePath = props.initialProjectRef?.worktreePath ?? null;
  const appliedWorkspace = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Apply the explicit branch-less workspace after the destination draft is ready.
  useEffect(() => {
    if (
      props.draftId ||
      appliedWorkspace.current ||
      !draftKey ||
      branch !== null ||
      !environmentId ||
      !projectId
    )
      return;
    appliedWorkspace.current = seedBranchlessThreadWorkspace(draftKey, {
      environmentId,
      projectId,
      worktreePath,
    });
  }, [branch, draftKey, environmentId, projectId, props.draftId, selectedProject, worktreePath]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Seed the persistent draft after the destination project creates it.
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
