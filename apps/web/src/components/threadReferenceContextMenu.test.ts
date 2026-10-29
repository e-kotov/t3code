import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId, type ContextMenuItem } from "@t3tools/contracts";
import { DraftId } from "../composerDraftStore";
import {
  showThreadReferenceContextMenu,
  type ReferenceThread,
  type StartReferencedThread,
} from "./threadReferenceContextMenu";

const state = vi.hoisted(() => ({
  add: vi.fn(),
  readProject: vi.fn(),
  configLoaded: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../state/entities", () => ({
  readProject: state.readProject,
  readEnvironmentServerConfigLoaded: state.configLoaded,
}));
vi.mock("./ui/toast", () => ({
  toastManager: { add: state.toast },
  stackedThreadToast: (value: unknown) => value,
}));
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
beforeEach(() => {
  vi.clearAllMocks();
  state.readProject.mockReset();
  state.configLoaded.mockReturnValue(true);
});

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

it.each(["new-thread-in-project", "new-thread-with-reference"])(
  "allocates a fresh scratch workspace for %s",
  async (action) => {
    state.readProject.mockReturnValue({ isScratch: true });
    const start = vi.fn<StartReferencedThread>(async () => ({
      draftId: DraftId.make("scratch-draft"),
      threadId: ThreadId.make("scratch-thread"),
    }));
    await showThreadReferenceContextMenu(
      { ...thread, branch: null, worktreePath: "/scratch/old-thread" },
      items.filter((item) => item.id !== "new-thread-on-branch"),
      undefined,
      start,
      async () => action,
    );
    expect(start.mock.calls[0]?.[1]?.worktreePath).toBeNull();
    expect(start).toHaveBeenCalledWith(
      { environmentId: thread.environmentId, projectId: thread.projectId },
      { branch: null, worktreePath: null, envMode: "local", startFromOrigin: false },
    );
    expect(state.readProject).toHaveBeenCalledWith({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
    });
    expect(state.add).toHaveBeenCalledTimes(action === "new-thread-with-reference" ? 1 : 0);
  },
);

it("preserves an ordinary branch-less project's existing workspace", async () => {
  state.readProject.mockReturnValue({ isScratch: false });
  const start = vi.fn<StartReferencedThread>(async () => null);
  await showThreadReferenceContextMenu(
    { ...thread, branch: null, worktreePath: "/detached-worktree" },
    [],
    undefined,
    start,
    async () => "new-thread-in-project",
  );
  expect(start.mock.calls[0]?.[1]).toEqual({
    branch: null,
    worktreePath: "/detached-worktree",
    envMode: "worktree",
    startFromOrigin: false,
  });
});

it("reports a failed plain draft creation and leaves its context untouched", async () => {
  const start = vi.fn<StartReferencedThread>(async () => {
    throw new Error("Navigation failed");
  });
  expect(
    await showThreadReferenceContextMenu(
      { ...thread, branch: null },
      [],
      undefined,
      start,
      async () => "new-thread-in-project",
    ),
  ).toBeNull();
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Could not create thread",
      description: "Navigation failed",
    }),
  );
  expect(state.add).not.toHaveBeenCalled();
});

it.each(["new-thread-in-project", "new-thread-with-reference"])(
  "waits for workspace metadata before %s and retries with fresh scratch state",
  async (action) => {
    const source = { ...thread, branch: null, worktreePath: "/scratch/old-thread" };
    state.readProject.mockReturnValue({});
    state.configLoaded.mockReturnValue(false);
    const start = vi.fn<StartReferencedThread>(async () => ({
      draftId: DraftId.make("reconnected-draft"),
      threadId: ThreadId.make("reconnected-thread"),
    }));
    await showThreadReferenceContextMenu(source, [], undefined, start, async () => action);
    expect(start.mock.calls.length).toBe(0);
    expect(state.add).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalled();
    expect(state.configLoaded).toHaveBeenCalledWith(source.environmentId);

    state.configLoaded.mockReturnValue(true);
    state.readProject.mockReturnValue({ isScratch: true });
    await showThreadReferenceContextMenu(source, [], undefined, start, async () => action);
    expect(start.mock.calls.length).toBe(1);
    expect(start.mock.calls[0]?.[1]?.worktreePath).toBeNull();
    expect(state.add).toHaveBeenCalledTimes(action === "new-thread-with-reference" ? 1 : 0);
  },
);

it("does not reuse a branch-less folder when its project has disappeared", async () => {
  const start = vi.fn<StartReferencedThread>(async () => null);
  await showThreadReferenceContextMenu(
    { ...thread, branch: null, worktreePath: "/old-folder" },
    [],
    undefined,
    start,
    async () => "new-thread-in-project",
  );
  expect(start).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalled();
});
