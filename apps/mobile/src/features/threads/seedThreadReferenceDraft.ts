import type { ThreadContextRecord } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import {
  getComposerDraftSnapshot,
  insertComposerDraftContext,
  updateComposerDraftSettings,
} from "../../state/use-composer-drafts";

export function seedThreadReferenceDraft(
  draftKey: string,
  reference: ThreadContextRecord,
  projectId: string,
): "waiting" | "applied" | "failed" {
  const draft = getComposerDraftSnapshot(draftKey);
  if (
    draft.project?.environmentId !== reference.environmentId ||
    draft.project.projectId !== projectId
  )
    return "waiting";
  if (draft.context?.records.some((record) => record.contextId === reference.contextId))
    return "applied";
  return insertComposerDraftContext(
    draftKey,
    {
      text: formatComposerContextReference(reference),
      context: { version: 1, records: [reference] },
    },
    { text: draft.text, start: draft.text.length, end: draft.text.length },
  )
    ? "applied"
    : "failed";
}

export function seedBranchlessThreadWorkspace(
  draftKey: string,
  source: { environmentId: string; projectId: string; worktreePath: string | null },
): boolean {
  const draft = getComposerDraftSnapshot(draftKey);
  if (
    draft.project?.environmentId !== source.environmentId ||
    draft.project.projectId !== source.projectId
  )
    return false;
  updateComposerDraftSettings(draftKey, {
    workspaceSelection: {
      mode: "local",
      branch: null,
      worktreePath: source.worktreePath,
      startFromOrigin: false,
    },
  });
  return true;
}
