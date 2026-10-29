import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { makeThreadShellFixture } from "../../test-fixtures";
import { useNewThreadReferenceMenu } from "./useNewThreadReferenceMenu";

type ReadAtom =
  | { kind: "project"; ref: { environmentId: string; projectId: string } }
  | { kind: "config"; environmentId: string };

const state = vi.hoisted(() => ({
  read: vi.fn<(atom: ReadAtom) => unknown>(),
  alert: vi.fn(),
  configLoaded: true,
  select: vi.fn(),
  projects: [] as { id: string; environmentId: string; isScratch?: true }[],
}));
vi.mock("../../state/entities", () => ({ useProjects: () => state.projects }));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { get: state.read } }));
vi.mock("../../state/projects", () => ({
  environmentProjects: { projectAtom: (ref: unknown) => ({ kind: "project", ref }) },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    configValueAtom: (environmentId: string) => ({ kind: "config", environmentId }),
  },
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
beforeEach(() => {
  state.projects = [];
  state.select.mockClear();
  state.alert.mockClear();
  state.configLoaded = true;
  state.read.mockReset();
  state.read.mockImplementation((atom) => {
    if (atom.kind === "config") return state.configLoaded ? {} : null;
    return (
      state.projects.find(
        (project) =>
          project.environmentId === atom.ref.environmentId && project.id === atom.ref.projectId,
      ) ?? null
    );
  });
});
vi.mock("../workspace/useSelectWorkspaceDetail", () => ({
  useSelectWorkspaceDetail: () => state.select,
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "new-request" }));

it.each(["new-thread-in-project", "new-thread-with-reference"])(
  "offers %s without Git and preserves the selected workspace",
  (action) => {
    state.select.mockClear();
    const thread = makeThreadShellFixture({
      environmentId: EnvironmentId.make("remote"),
      projectId: ProjectId.make("selected-project"),
      id: ThreadId.make("selected-thread"),
      title: "Selected conversation",
      branch: null,
      worktreePath: null,
    });
    const menu = useNewThreadReferenceMenu(thread);
    expect(menu.actions.map((item) => [item.id, item.title])).toEqual([
      ["new-thread-in-project", "New thread"],
      ["new-thread-with-reference", "New thread with reference"],
    ]);
    expect(state.read).not.toHaveBeenCalled();
    expect(menu.handleAction(action)).toBe(true);
    const draft = state.select.mock.calls[0]?.[0].params.draft;
    expect(draft.worktreePath).toBeNull();
    expect(draft).toMatchObject({
      requestId: "new-request",
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      branch: null,
      worktreePath: null,
    });
    if (action === "new-thread-with-reference") {
      expect(draft.referenceThread).toMatchObject({
        kind: "thread",
        environmentId: thread.environmentId,
        threadId: thread.id,
        title: thread.title,
      });
    } else {
      expect(draft).not.toHaveProperty("referenceThread");
    }
  },
);

it("keeps Git creation with the existing branch action and ignores unrelated actions", () => {
  state.select.mockClear();
  const menu = useNewThreadReferenceMenu(makeThreadShellFixture({ branch: "feature" }));
  expect(menu.actions.map((item) => [item.id, item.title])).toEqual([
    ["new-thread-with-reference", "New thread on feature with reference"],
  ]);
  expect(menu.handleAction("rename")).toBe(false);
  expect(state.select).not.toHaveBeenCalled();
});

it.each(["new-thread-in-project", "new-thread-with-reference"])(
  "allocates a fresh scratch workspace for %s",
  (action) => {
    const thread = makeThreadShellFixture({
      environmentId: EnvironmentId.make("remote"),
      projectId: ProjectId.make("scratch"),
      id: ThreadId.make("old-scratch-thread"),
      title: "Scratch source",
      branch: null,
      worktreePath: "/scratch/old-thread",
    });
    state.projects = [
      { environmentId: "other", id: thread.projectId },
      { environmentId: thread.environmentId, id: thread.projectId, isScratch: true },
    ];
    const menu = useNewThreadReferenceMenu(thread);
    expect(state.read).not.toHaveBeenCalled();
    expect(menu.handleAction(action)).toBe(true);
    const draft = state.select.mock.calls[0]?.[0].params.draft;
    expect(draft.worktreePath).toBeNull();
    expect(draft).toMatchObject({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      branch: null,
      worktreePath: null,
    });
    if (action === "new-thread-with-reference") {
      expect(draft.referenceThread).toMatchObject({
        environmentId: thread.environmentId,
        threadId: thread.id,
      });
    } else {
      expect(draft).not.toHaveProperty("referenceThread");
    }
  },
);

it("does not treat a matching project ID on another environment as scratch", () => {
  const thread = makeThreadShellFixture({
    environmentId: EnvironmentId.make("remote"),
    projectId: ProjectId.make("project"),
    id: ThreadId.make("detached-thread"),
    title: "Detached source",
    branch: null,
    worktreePath: "/detached-worktree",
  });
  state.projects = [
    { environmentId: "other", id: thread.projectId, isScratch: true },
    { environmentId: thread.environmentId, id: thread.projectId },
  ];
  useNewThreadReferenceMenu(thread).handleAction("new-thread-in-project");
  expect(state.select.mock.calls[0]?.[0].params.draft.worktreePath).toBe("/detached-worktree");
});

it.each(["new-thread-in-project", "new-thread-with-reference"])(
  "waits for workspace metadata before %s and retries with fresh scratch state",
  (action) => {
    const thread = makeThreadShellFixture({
      environmentId: EnvironmentId.make("remote"),
      projectId: ProjectId.make("scratch"),
      id: ThreadId.make("old-scratch-thread"),
      title: "Scratch source",
      branch: null,
      worktreePath: "/scratch/old-thread",
    });
    state.projects = [{ environmentId: thread.environmentId, id: thread.projectId }];
    state.configLoaded = false;
    const menu = useNewThreadReferenceMenu(thread);
    expect(state.read).not.toHaveBeenCalled();
    expect(menu.handleAction(action)).toBe(true);
    expect(state.select.mock.calls.length).toBe(0);
    expect(state.alert).toHaveBeenCalled();
    expect(state.read).toHaveBeenCalledWith({
      kind: "config",
      environmentId: thread.environmentId,
    });

    state.configLoaded = true;
    state.projects = [
      { environmentId: thread.environmentId, id: thread.projectId, isScratch: true },
    ];
    expect(menu.handleAction(action)).toBe(true);
    expect(state.select.mock.calls.length).toBe(1);
    const draft = state.select.mock.calls[0]?.[0].params.draft;
    expect(draft.worktreePath).toBeNull();
    expect(Boolean(draft.referenceThread)).toBe(action === "new-thread-with-reference");
  },
);

it("does not reuse a branch-less folder when its project has disappeared", () => {
  const thread = makeThreadShellFixture({
    environmentId: EnvironmentId.make("remote"),
    projectId: ProjectId.make("missing-project"),
    id: ThreadId.make("orphan-thread"),
    title: "Orphan source",
    branch: null,
    worktreePath: "/old-folder",
  });
  expect(useNewThreadReferenceMenu(thread).handleAction("new-thread-in-project")).toBe(true);
  expect(state.select).not.toHaveBeenCalled();
  expect(state.alert).toHaveBeenCalled();
});
