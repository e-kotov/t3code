import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ContextMenuItem } from "@t3tools/contracts";
import { DraftId } from "../composerDraftStore";
import {
  showThreadReferenceContextMenu,
  type ReferenceThread,
  type StartReferencedThread,
} from "./threadReferenceContextMenu";

const state = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ addThreadContexts: state.add }) },
  DraftId: { make: (value: string) => value },
}));
const thread: ReferenceThread = {
  environmentId: EnvironmentId.make("remote"),
  projectId: ProjectId.make("project"),
  id: ThreadId.make("clicked-thread"),
  title: "Selected conversation",
  branch: "main",
  worktreePath: null,
};
const items: ContextMenuItem<"new-thread-on-branch" | "rename">[] = [
  { id: "new-thread-on-branch", label: "New thread on main" },
  { id: "rename", label: "Rename thread" },
];
beforeEach(() => vi.clearAllMocks());

it.each(["main", null])(
  "offers referenced creation with branch %s in the clicked workspace",
  async (branch) => {
    const source = { ...thread, branch };
    const sourceItems = branch ? items : items.filter((item) => item.id !== "new-thread-on-branch");
    const start = vi.fn<StartReferencedThread>(async () => ({
      draftId: DraftId.make("new-draft"),
      threadId: ThreadId.make("new-thread"),
    }));
    const show = vi.fn(async (_items: readonly ContextMenuItem[]) => "new-thread-with-reference");
    expect(
      await showThreadReferenceContextMenu(source, sourceItems, { x: 4, y: 5 }, start, show),
    ).toBeNull();
    expect(show.mock.calls[0]?.[0].map((item) => item.id)).toEqual([
      branch ? "new-thread-on-branch" : "new-thread-in-project",
      "new-thread-with-reference",
      "rename",
    ]);
    expect(show.mock.calls[0]?.[0].map((item) => item.label)).toEqual([
      branch ? "New thread on main" : "New thread",
      branch ? "New thread on main with reference" : "New thread with reference",
      "Rename thread",
    ]);
    expect(start).toHaveBeenCalledWith(
      { environmentId: thread.environmentId, projectId: thread.projectId },
      {
        branch,
        worktreePath: null,
        envMode: "local",
        startFromOrigin: false,
      },
    );
    expect(state.add).toHaveBeenCalledWith("new-draft", [
      expect.objectContaining({
        kind: "thread",
        threadId: thread.id,
        environmentId: thread.environmentId,
        title: thread.title,
      }),
    ]);
  },
);

it("preserves the selected worktree and branch", async () => {
  const start = vi.fn<StartReferencedThread>(async () => null);
  await showThreadReferenceContextMenu(
    { ...thread, branch: "feature", worktreePath: "/worktree" },
    items,
    undefined,
    start,
    async () => "new-thread-with-reference",
  );
  expect(start.mock.calls[0]?.[1]).toEqual({
    branch: "feature",
    worktreePath: "/worktree",
    envMode: "worktree",
    startFromOrigin: false,
  });
  expect(state.add).not.toHaveBeenCalled();
});

it.each(["main", null])(
  "leaves other actions and dismissal alone with branch %s",
  async (branch) => {
    const source = { ...thread, branch };
    const start = vi.fn<StartReferencedThread>(async () => null);
    expect(
      await showThreadReferenceContextMenu(source, items, undefined, start, async () => "rename"),
    ).toBe("rename");
    expect(
      await showThreadReferenceContextMenu(source, items, undefined, start, async () => null),
    ).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
  },
);

it("opens a plain branch-less draft without attaching the source", async () => {
  const start = vi.fn<StartReferencedThread>(async () => ({
    draftId: DraftId.make("plain-draft"),
    threadId: ThreadId.make("plain-thread"),
  }));
  await showThreadReferenceContextMenu(
    { ...thread, branch: null },
    items.filter((item) => item.id !== "new-thread-on-branch"),
    undefined,
    start,
    async () => "new-thread-in-project",
  );
  expect(start).toHaveBeenCalledWith(
    { environmentId: thread.environmentId, projectId: thread.projectId },
    { branch: null, worktreePath: null, envMode: "local", startFromOrigin: false },
  );
  expect(state.add).not.toHaveBeenCalled();
});
