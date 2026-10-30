import { Atom } from "effect/reactivity";
import { useSyncExternalStore } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ServerSettingsPatch,
  type ScheduledTaskUpsertInput,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { ScheduledTasksSettings } from "./ScheduledTasksSettings";

const environmentId = EnvironmentId.make("laptop");
const projectId = ProjectId.make("project");
const task: ScheduledTask = {
  id: ScheduledTaskId.make("nightly"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId,
  threadId: ThreadId.make("source-thread"),
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

interface FixtureSnapshot {
  readonly connected: boolean;
  readonly tasksLoaded: boolean;
  readonly secondary: boolean;
  readonly sourceArchived: boolean;
  readonly settingsByEnvironment: ReadonlyMap<string, typeof DEFAULT_UNIFIED_SETTINGS>;
}

const state = vi.hoisted(() => ({
  snapshot: {
    connected: true,
    tasksLoaded: true,
    secondary: false,
    sourceArchived: false,
    settingsByEnvironment: new Map(),
  } as FixtureSnapshot,
  listeners: new Set<() => void>(),
  updateSettings: vi.fn<(environmentId: EnvironmentId, patch: ServerSettingsPatch) => void>(),
  upsert:
    vi.fn<
      (request: {
        environmentId: EnvironmentId;
        input: ScheduledTaskUpsertInput;
      }) => Promise<{ _tag: "Success"; value: unknown }>
    >(),
  providers: null as unknown as Atom.Writable<ReadonlyArray<ServerProvider>>,
}));
const secondaryId = EnvironmentId.make("secondary");
const permissions = vi.hoisted(() => new Map<string, Atom.Writable<boolean>>());

function subscribeFixture(listener: () => void) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

function fixtureSnapshot() {
  return state.snapshot;
}

function useFixtureSnapshot() {
  return useSyncExternalStore(subscribeFixture, fixtureSnapshot);
}

function publishFixture(snapshot: FixtureSnapshot) {
  state.snapshot = snapshot;
  for (const listener of state.listeners) listener();
}

function setup() {
  state.listeners.clear();
  state.snapshot = {
    connected: true,
    tasksLoaded: true,
    secondary: false,
    sourceArchived: false,
    settingsByEnvironment: new Map(),
  };
  state.updateSettings.mockReset();
  state.updateSettings.mockImplementation((id, patch) => {
    const settings = state.snapshot.settingsByEnvironment.get(id) ?? DEFAULT_UNIFIED_SETTINGS;
    const settingsByEnvironment = new Map(state.snapshot.settingsByEnvironment);
    settingsByEnvironment.set(id, {
      ...settings,
      scheduledTaskThreadMode: patch.scheduledTaskThreadMode ?? settings.scheduledTaskThreadMode,
    });
    publishFixture({ ...state.snapshot, settingsByEnvironment });
  });
  state.upsert.mockReset();
  state.upsert.mockResolvedValue({ _tag: "Success", value: { task } });
  state.providers = Atom.make<ReadonlyArray<ServerProvider>>([
    {
      instanceId: task.modelSelection.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-09-17T00:00:00.000Z",
      models: [
        {
          slug: task.modelSelection.model,
          name: "Test model",
          isCustom: false,
          capabilities: null,
        },
      ],
      slashCommands: [],
      skills: [],
    },
  ]);
  permissions.clear();
  permissions.set(environmentId, Atom.make(true));
  permissions.set(secondaryId, Atom.make(true));
  permissions.set("", Atom.make(false));
}

function secondaryEnvironment(snapshot: FixtureSnapshot) {
  return { ...environment(snapshot), environmentId: secondaryId, label: "Secondary" };
}

function environment(snapshot: FixtureSnapshot) {
  return {
    environmentId,
    label: "Laptop",
    connection: { phase: snapshot.connected ? "connected" : "disconnected" },
    serverConfig: snapshot.connected ? { environment: { platform: "linux" } } : null,
  };
}

vi.mock(import("./SettingsScopeContext"), async (original) => {
  const useMockSettingsScope = () => {
    const snapshot = useFixtureSnapshot();
    const entry = environment(snapshot);
    return {
      scope: { kind: "all", label: "All", members: [], environmentIds: [environmentId] },
      environments: snapshot.secondary ? [entry, secondaryEnvironment(snapshot)] : [entry],
      connectedEnvironments: snapshot.connected
        ? snapshot.secondary
          ? [entry, secondaryEnvironment(snapshot)]
          : [entry]
        : [],
      environment: entry,
      target: null,
      targets: [],
    };
  };
  return {
    ...(await original()),
    useSettingsScope: useMockSettingsScope as never,
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();

  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => state.providers) as never,
      upsertScheduledTask: {
        ...actual.serverEnvironment.upsertScheduledTask,
        label: "automation-test-upsert",
        permissionAtom: (id: string | null) => permissions.get(id ?? "")!,
      },
    },
  };
});
// Mirrors the real query: a null request (disconnected environment) has no data.
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((request: unknown) => {
    const snapshot = useFixtureSnapshot();
    return {
      data: request === null ? null : { tasks: snapshot.tasksLoaded ? [task] : [] },
      error: null,
      isPending: false,
      refresh: vi.fn(),
    };
  }) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: ((id: EnvironmentId) => {
    const snapshot = useFixtureSnapshot();
    return id === secondaryId ? secondaryEnvironment(snapshot) : environment(snapshot);
  }) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => [
    { id: projectId, environmentId, title: "Project" },
    { id: ProjectId.make("other-project"), environmentId, title: "Other project" },
  ]) as never,
  useThreadShellsForProjectRefs: ((
    refs: ReadonlyArray<{ environmentId: EnvironmentId; projectId: ProjectId }>,
  ) => {
    const snapshot = useFixtureSnapshot();
    return [
      {
        id: task.threadId,
        projectId,
        environmentId,
        title: "Source conversation",
        archivedAt: snapshot.sourceArchived ? "2026-09-18T00:00:00.000Z" : null,
        deletedAt: null,
      },
      {
        id: ThreadId.make("archived-thread"),
        projectId,
        environmentId,
        title: "Archived conversation",
        archivedAt: "2026-09-18T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: ThreadId.make("other-thread"),
        projectId: ProjectId.make("other-project"),
        environmentId,
        title: "Other conversation",
        archivedAt: null,
        deletedAt: null,
      },
    ].filter((thread) =>
      refs.some(
        (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
      ),
    );
  }) as never,
}));
vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: ((
    id: EnvironmentId,
    selector?: (value: typeof DEFAULT_UNIFIED_SETTINGS) => unknown,
  ) => {
    const snapshot = useFixtureSnapshot();
    const settings = snapshot.settingsByEnvironment.get(id) ?? DEFAULT_UNIFIED_SETTINGS;
    return selector ? selector(settings) : settings;
  }) as never,
  useUpdateEnvironmentSettings: ((id: EnvironmentId) => (patch: ServerSettingsPatch) =>
    state.updateSettings(id, patch)) as never,
}));

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
  readEnvironmentScope: (() => true) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useAtomCommand: ((
      command: Parameters<typeof actual.useAtomCommand>[0],
      options: Parameters<typeof actual.useAtomCommand>[1],
    ) =>
      command.label === "automation-test-upsert"
        ? state.upsert
        : actual.useAtomCommand(command, options)) as never,
  };
});

describe("scheduled task thread controls", () => {
  it("saves the chat default only on the selected environment without changing existing tasks", async () => {
    setup();
    publishFixture({ ...state.snapshot, secondary: true });
    await using screen = await render(<ScheduledTasksSettings />);
    await expect
      .element(page.getByLabelText("Default automation thread on Laptop"))
      .toHaveTextContent("New thread, same project");
    await page.getByLabelText("Default automation thread on Secondary").click();
    await page.getByRole("option", { name: "Current thread", exact: true }).click();
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith(secondaryId, {
      scheduledTaskThreadMode: "current-thread",
    });
    await expect
      .element(page.getByLabelText("Default automation thread on Secondary"))
      .toHaveTextContent("Current thread");
    await expect
      .element(page.getByLabelText("Default automation thread on Laptop"))
      .toHaveTextContent("New thread, same project");
    expect(state.upsert).not.toHaveBeenCalled();
    await screen.rerender(<ScheduledTasksSettings taskId={task.id} />);
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("Continue: Source conversation");
  });

  it("names a saved archived thread without offering other archived threads", async () => {
    setup();
    publishFixture({ ...state.snapshot, sourceArchived: true });
    await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("Continue: Source conversation (archived)");
    await page.getByLabelText("Thread", { exact: true }).click();
    await expect
      .element(page.getByRole("option", { name: "Continue: Archived conversation" }))
      .not.toBeInTheDocument();
  });

  it("saves an explicit new-thread choice without changing the workspace", async () => {
    setup();
    await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await page.getByLabelText("Thread", { exact: true }).click();
    await page.getByRole("option", { name: "New thread each run" }).click();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(state.upsert).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        id: task.id,
        requireExisting: true,
        title: task.title,
        prompt: task.prompt,
        enabled: task.enabled,
        schedule: task.schedule,
        projectId,
        threadId: null,
        workspaceStrategy: task.workspaceStrategy,
        modelSelection: task.modelSelection,
        runtimeMode: task.runtimeMode,
        interactionMode: task.interactionMode,
        creationSource: "web",
      },
    });
  });

  it("keeps a saved binding and workspace when canceling and reopening an edit", async () => {
    setup();
    await using screen = await render(<ScheduledTasksSettings />);
    await screen.getByRole("button", { name: "Actions for Review issues" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("Continue: Source conversation");
    await page.getByLabelText("Thread", { exact: true }).click();
    await page.getByRole("option", { name: "New thread each run" }).click();
    await expect
      .element(page.getByLabelText("Workspace", { exact: true }))
      .toHaveTextContent("Use the project checkout");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Actions for Review issues" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("Continue: Source conversation");
    await expect
      .element(page.getByLabelText("Workspace", { exact: true }))
      .toHaveTextContent("Use the project checkout");
  });

  it("preserves the workspace and unsaved thread choice through disconnect and reconnect", async () => {
    setup();
    await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await page.getByLabelText("Thread", { exact: true }).click();
    await page.getByRole("option", { name: "New thread each run" }).click();
    await act(() => publishFixture({ ...state.snapshot, connected: false }));
    await expect.element(page.getByLabelText("Thread", { exact: true })).toBeDisabled();
    await act(() => publishFixture({ ...state.snapshot, connected: true }));
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("New thread each run");
    await expect
      .element(page.getByLabelText("Workspace", { exact: true }))
      .toHaveTextContent("Use the project checkout");
    await page.getByLabelText("Thread", { exact: true }).click();
    await page.getByRole("option", { name: "Continue: Source conversation" }).click();
    await expect
      .element(page.getByLabelText("Workspace", { exact: true }))
      .toHaveTextContent("Use the project checkout");
  });

  it("clears the old thread when selecting another project and lists only that project's threads", async () => {
    setup();
    await using _screen = await render(<ScheduledTasksSettings taskId={task.id} />);
    await page.getByLabelText("Project", { exact: true }).click();
    await page.getByRole("option", { name: "Other project", exact: true }).click();
    await expect
      .element(page.getByLabelText("Thread", { exact: true }))
      .toHaveTextContent("New thread each run");
    await page.getByLabelText("Thread", { exact: true }).click();
    await expect
      .element(page.getByRole("option", { name: "Continue: Source conversation" }))
      .not.toBeInTheDocument();
    await page.getByRole("option", { name: "Continue: Other conversation" }).click();
    await expect
      .element(page.getByLabelText("Workspace", { exact: true }))
      .toHaveTextContent("Use the project checkout");
  });
});
