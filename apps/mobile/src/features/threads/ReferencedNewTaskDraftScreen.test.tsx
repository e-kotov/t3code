import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { ComposerDraftWorkspaceSelection } from "../../state/use-composer-drafts";
import { ReferencedNewTaskDraftScreen } from "./ReferencedNewTaskDraftScreen";

const state = vi.hoisted(() => ({
  selectedProject: { environmentId: "remote", id: "project" },
  draft: {
    text: "Keep my writing",
    project: { environmentId: "remote", projectId: "project" },
    workspaceSelection: undefined as ComposerDraftWorkspaceSelection | undefined,
  },
}));
vi.mock("./NewTaskDraftScreen", () => ({ NewTaskDraftScreen: () => null }));
vi.mock("./new-task-flow-provider", () => ({
  useNewTaskFlow: () => ({
    draftKey: "draft",
    selectedProject: state.selectedProject,
    setProject: (project: { environmentId: string; id: string }) => {
      state.draft.project = { environmentId: project.environmentId, projectId: project.id };
    },
  }),
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => state.draft,
  insertComposerDraftContext: vi.fn(),
  updateComposerDraftSettings: (
    _key: string,
    settings: { workspaceSelection: ComposerDraftWorkspaceSelection },
  ) => {
    state.draft = { ...state.draft, ...settings };
  },
}));

function setup() {
  state.selectedProject = { environmentId: "remote", id: "project" };
  state.draft = {
    text: "Keep my writing",
    project: { environmentId: "remote", projectId: "project" },
    workspaceSelection: { mode: "worktree", branch: "old", worktreePath: "/old-folder" },
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    render: (worktreePath: string | null, projectId = "project") =>
      act(() =>
        root.render(
          <ReferencedNewTaskDraftScreen
            initialProjectRef={{
              environmentId: "remote",
              projectId,
              branch: null,
              worktreePath,
            }}
          />,
        ),
      ),
    [Symbol.dispose]() {
      act(() => root.unmount());
      globals.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

it.each([null, "/detached-worktree"])(
  "persists an explicit branch-less workspace %s without overwriting the draft text",
  (worktreePath) => {
    using screen = setup();
    screen.render(worktreePath);
    expect(state.draft.workspaceSelection?.worktreePath).toBe(worktreePath);
    expect(state.draft.workspaceSelection).toEqual({
      mode: "local",
      branch: null,
      worktreePath,
      startFromOrigin: false,
    });
    expect(state.draft.text).toBe("Keep my writing");
    state.draft.workspaceSelection = {
      mode: "local",
      branch: "user-choice",
      worktreePath: "/user-folder",
    };
    screen.render(worktreePath);
    expect(state.draft.workspaceSelection.worktreePath).toBe("/user-folder");
  },
);

it("waits for the destination project before setting the branch-less workspace", () => {
  using screen = setup();
  screen.render("/detached-worktree", "other-project");
  expect(state.draft.workspaceSelection?.worktreePath).toBe("/old-folder");
  state.draft.project = { environmentId: "remote", projectId: "other-project" };
  state.selectedProject = { environmentId: "remote", id: "other-project" };
  screen.render("/detached-worktree", "other-project");
  expect(state.draft.workspaceSelection?.worktreePath).toBe("/detached-worktree");
});

it("repairs a fallback-stamped draft only after the intended project is selected", () => {
  using screen = setup();
  state.draft.project = { environmentId: "fallback-environment", projectId: "fallback-project" };
  screen.render("/detached-worktree");
  expect(state.draft.project).toEqual({ environmentId: "remote", projectId: "project" });
  expect(state.draft.workspaceSelection?.worktreePath).toBe("/detached-worktree");
  expect(state.draft.text).toBe("Keep my writing");
});
