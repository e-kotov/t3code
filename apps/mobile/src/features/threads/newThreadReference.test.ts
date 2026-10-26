import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { formatComposerContextReference, collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { newThreadReferenceRoute } from "./newThreadReference";

it("opens the clicked thread's workspace with a standard, scoped thread reference", () => {
  const source = {
    environmentId: EnvironmentId.make("remote"), projectId: ProjectId.make("project"),
    id: ThreadId.make("source"), title: "Source conversation", branch: "main", worktreePath: null,
  };
  const route = newThreadReferenceRoute(source, "request");
  expect(route).toMatchObject({ requestId: "request", environmentId: "remote", projectId: "project", branch: "main", worktreePath: null });
  expect(route.referenceThread).toMatchObject({ kind: "thread", environmentId: "remote", threadId: "source", title: source.title });
  const references = collectComposerContextReferences(formatComposerContextReference(route.referenceThread!));
  expect(references).toEqual([expect.objectContaining({ kind: "thread", contextId: route.referenceThread?.contextId, label: source.title })]);
  expect(newThreadReferenceRoute({ ...source, branch: "feature", worktreePath: "/worktree" }, "other")).toMatchObject({ requestId: "other", branch: "feature", worktreePath: "/worktree" });
});
