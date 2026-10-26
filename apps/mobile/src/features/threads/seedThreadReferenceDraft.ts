import type { ThreadContextRecord } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { getComposerDraftSnapshot, insertComposerDraftContext } from "../../state/use-composer-drafts";

export function seedThreadReferenceDraft(
  draftKey: string,
  reference: ThreadContextRecord,
  projectId: string,
): "waiting" | "applied" | "failed" {
  const draft = getComposerDraftSnapshot(draftKey);
  if (draft.project?.environmentId !== reference.environmentId || draft.project.projectId !== projectId) return "waiting";
  if (draft.context?.records.some((record) => record.contextId === reference.contextId)) return "applied";
  return insertComposerDraftContext(draftKey, {
    text: formatComposerContextReference(reference),
    context: { version: 1, records: [reference] },
  }, { text: draft.text, start: draft.text.length, end: draft.text.length }) ? "applied" : "failed";
}
