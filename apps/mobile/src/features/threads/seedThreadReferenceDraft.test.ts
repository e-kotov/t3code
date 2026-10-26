import { beforeEach, expect, it, vi } from "vite-plus/test";
import {
  ComposerContextId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ThreadContextRecord,
} from "@t3tools/contracts";
import { seedThreadReferenceDraft } from "./seedThreadReferenceDraft";

const state = vi.hoisted(() => ({
  draft: {} as Record<string, unknown>,
  insert: vi.fn(() => true),
}));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => state.draft,
  insertComposerDraftContext: state.insert,
}));
const reference: ThreadContextRecord = {
  version: 1,
  kind: "thread",
  contextId: ComposerContextId.make("thread_source"),
  label: "Source",
  title: "Source",
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("source"),
};
beforeEach(() => {
  state.draft = {
    text: "Keep my writing",
    project: { environmentId: reference.environmentId, projectId: ProjectId.make("project") },
  };
  state.insert.mockClear();
  state.insert.mockReturnValue(true);
});

it("waits for the destination draft and never writes into an old project or environment", () => {
  expect(seedThreadReferenceDraft("draft", reference, "other-project")).toBe("waiting");
  expect(
    seedThreadReferenceDraft(
      "draft",
      { ...reference, environmentId: EnvironmentId.make("other") },
      "project",
    ),
  ).toBe("waiting");
  expect(state.insert).not.toHaveBeenCalled();
});

it("appends the linked context without replacing existing writing or a selection", () => {
  expect(seedThreadReferenceDraft("draft", reference, "project")).toBe("applied");
  expect(state.insert).toHaveBeenCalledWith(
    "draft",
    {
      text: expect.stringContaining("t3-context://"),
      context: { version: 1, records: [reference] },
    },
    { text: "Keep my writing", start: 15, end: 15 },
  );
});

it("does not duplicate a reference on remount and reports rejected insertions", () => {
  state.draft.context = { version: 1, records: [reference] };
  expect(seedThreadReferenceDraft("draft", reference, "project")).toBe("applied");
  expect(state.insert).not.toHaveBeenCalled();
  delete state.draft.context;
  state.insert.mockReturnValue(false);
  expect(seedThreadReferenceDraft("draft", reference, "project")).toBe("failed");
});
