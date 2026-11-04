import type {
  EnvironmentConnectionPhase,
  EnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { ChatHeader } from "./ChatHeader";
import type { HeaderModelContext } from "./HeaderContextLabels";
import "../../index.css";

const fixture = vi.hoisted(() => ({
  presentations: new Map<string, EnvironmentPresentation>(),
  shells: new Map<string, EnvironmentThreadShell>(),
  listeners: new Set<() => void>(),
  settings: null as UnifiedSettings | null,
  setProviders: (_id: EnvironmentId, _providers: ReadonlyArray<ServerProvider>): void => {
    throw new Error("Provider fixture is not initialized");
  },
}));

vi.mock(import("../../state/presentation"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    useEnvironmentPresentation: (id: EnvironmentId | null) => ({
      isReady: true,
      presentation: useSyncExternalStore(
        (listener) => {
          fixture.listeners.add(listener);
          return () => {
            fixture.listeners.delete(listener);
          };
        },
        () => (id ? (fixture.presentations.get(id) ?? null) : null),
      ),
    }),
  };
});
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (ref: ScopedThreadRef | null) =>
    ref ? (fixture.shells.get(ref.environmentId) ?? null) : null,
}));
vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  const { appAtomRegistry } = await import("../../rpc/atomRegistry");
  const providers = Atom.family((_id: EnvironmentId) =>
    Atom.keepAlive(Atom.make<ReadonlyArray<ServerProvider>>([])),
  );
  fixture.setProviders = (id, value) => {
    appAtomRegistry.set(providers(id), value);
  };
  return {
    ...(await original()),
    providersIgnoringCheckedAtAtom: providers,
  };
});
vi.mock(import("../../hooks/useSettings"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useEnvironmentSettings: ((
      _id: EnvironmentId,
      selector?: (settings: UnifiedSettings) => unknown,
    ) => {
      const settings = fixture.settings ?? DEFAULT_UNIFIED_SETTINGS;
      return selector ? selector(settings) : settings;
    }) as typeof actual.useEnvironmentSettings,
  };
});

const MAC = EnvironmentId.make("header-mac");
const REMOTE = EnvironmentId.make("header-remote");
const THREAD = ThreadId.make("header-thread");
const INSTANCE = ProviderInstanceId.make("codex");

function presentation(label: string, phase: EnvironmentConnectionPhase): EnvironmentPresentation {
  return {
    entry: { target: { label } },
    connection: { phase, error: null, traceId: null },
    serverConfig: null,
  } as EnvironmentPresentation;
}

function provider(name: string): ServerProvider {
  return {
    instanceId: INSTANCE,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-03T12:00:00Z",
    slashCommands: [],
    skills: [],
    models: [
      { slug: "shared-model", name, shortName: name, isCustom: false, capabilities: null },
      { slug: "other-model", name: "Other available model", isCustom: false, capabilities: null },
    ],
  };
}

function setup() {
  fixture.presentations.clear();
  fixture.shells.clear();
  fixture.listeners.clear();
  fixture.settings = null;
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  for (const [id, label, modelName] of [
    [MAC, "Mac", "GPT-6.1 Sol"],
    [REMOTE, "GWDG", "Remote custom model"],
  ] as const) {
    fixture.presentations.set(id, presentation(label, "connected"));
    fixture.setProviders(id, [provider(modelName)]);
    fixture.shells.set(id, {
      modelSelection: { instanceId: INSTANCE, model: "shared-model" },
      runtime: null,
      projectId: null,
    } as unknown as EnvironmentThreadShell);
  }
}

function header(
  environmentId = REMOTE,
  project: EnvironmentProject | null = null,
  defaultModelSelection?: ModelSelection | null,
  modelContext?: HeaderModelContext,
) {
  return (
    <AppAtomRegistryProvider>
      <div
        className="flex h-12 w-full items-center bg-background px-3"
        data-testid="header-context"
      >
        <ChatHeader
          activeThreadEnvironmentId={environmentId}
          activeThreadId={THREAD}
          activeThreadTitle="Header indicators"
          isServerThread={false}
          activeProject={project}
          defaultModelSelection={defaultModelSelection}
          modelContext={modelContext}
          parentThreadLink={null}
          onOpenThread={() => {}}
          rightPanelOpen={false}
          onNewThreadInProject={() => {}}
        />
      </div>
    </AppAtomRegistryProvider>
  );
}

it("follows the active machine through pending, recovery and a later disconnect", async () => {
  setup();
  await page.viewport(1000, 260);
  await using screen = await render(header());
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE === "before") {
    await screen
      .getByTestId("header-context")
      .screenshot({ path: "../../../../../.t3/header-evidence/before-header.png" });
    return;
  }
  await expect
    .element(screen.getByRole("button", { name: "Machine: GWDG. Connected" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Model: Remote custom model/ }))
    .toBeVisible();
  const machine = screen.container.querySelector("[data-header-machine]");
  expect(machine?.lastElementChild?.textContent).toBe("/");
  expect(machine?.className).not.toContain("border");
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
    await screen
      .getByTestId("header-context")
      .screenshot({ path: "../../../../../.t3/header-evidence/after-header.png" });
  }
  for (const phase of [
    "connecting",
    "reconnecting",
    "connected",
    "offline",
    "reconnecting",
    "connected",
  ] as const) {
    await act(() => {
      fixture.presentations.set(REMOTE, presentation("GWDG", phase));
      for (const listener of fixture.listeners) listener();
    });
    const pending = phase === "connecting" || phase === "reconnecting";
    expect(screen.container.querySelector("[data-header-machine] .bg-warning") !== null).toBe(
      pending,
    );
    expect(
      screen.container.querySelector("[data-header-machine] .motion-safe\\:animate-status-ping") !==
        null,
    ).toBe(pending);
    if (pending)
      await expect.element(screen.getByRole("button", { name: `GWDG is ${phase}` })).toBeVisible();
    if (phase === "reconnecting" && import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
      await screen
        .getByTestId("header-context")
        .screenshot({ path: "../../../../../.t3/header-evidence/reconnecting.png" });
    }
  }
  await screen.rerender(header(MAC));
  await expect
    .element(screen.getByRole("button", { name: "Machine: Mac. Connected" }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Model: GPT-6.1 Sol/ })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /GWDG/ })).not.toBeInTheDocument();
});

it("updates an unsent model choice and clears the previous machine's model when switching", async () => {
  setup();
  await page.viewport(390, 260);
  await using screen = await render(header());
  const store = useComposerDraftStore.getState();
  await act(() =>
    store.setModelSelection(scopeThreadRef(REMOTE, THREAD), {
      instanceId: INSTANCE,
      model: "other-model",
    }),
  );
  await expect
    .element(screen.getByRole("button", { name: /^Model: Other available model/ }))
    .toBeVisible();
  const editingTarget = DraftId.make("header-queued-edit");
  const editingContext = { thread: fixture.shells.get(REMOTE), draftTarget: editingTarget };
  await screen.rerender(header(REMOTE, null, undefined, editingContext));
  await expect
    .element(screen.getByRole("button", { name: /^Model: Remote custom model/ }))
    .toBeVisible();
  await act(() =>
    store.setModelSelection(editingTarget, { instanceId: INSTANCE, model: "other-model" }),
  );
  await expect
    .element(screen.getByRole("button", { name: /^Model: Other available model/ }))
    .toBeVisible();
  await act(() =>
    store.setModelSelection(editingTarget, { instanceId: INSTANCE, model: "shared-model" }),
  );
  await screen.rerender(header());
  await expect
    .element(screen.getByRole("button", { name: /^Model: Other available model/ }))
    .toBeVisible();
  await screen.rerender(header(MAC));
  await expect.element(screen.getByRole("button", { name: /^Model: GPT-6.1 Sol/ })).toBeVisible();
  expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
    await screen
      .getByTestId("header-context")
      .screenshot({ path: "../../../../../.t3/header-evidence/narrow.png" });
  }
});

it("uses the composer's available provider fallback and project default before a draft has a choice", async () => {
  setup();
  const fallback = {
    ...provider("Available fallback"),
    instanceId: ProviderInstanceId.make("codex-fallback"),
    models: [
      { slug: "fallback-model", name: "Available fallback", isCustom: false, capabilities: null },
    ],
  };
  fixture.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      [fallback.instanceId]: { driver: fallback.driver, enabled: true, config: {} },
    },
  };
  fixture.setProviders(REMOTE, [
    { ...provider("Unavailable model"), availability: "unavailable" },
    fallback,
  ]);
  await using screen = await render(header());
  await expect
    .element(screen.getByRole("button", { name: /^Model: Available fallback/ }))
    .toBeVisible();
  const unlistedThread = {
    ...fixture.shells.get(REMOTE),
    modelSelection: { instanceId: fallback.instanceId, model: "fallback-model" },
  } as EnvironmentThreadShell;
  fixture.shells.delete(REMOTE);
  const project = {
    environmentId: REMOTE,
    id: ProjectId.make("header-project"),
    title: "Fleet",
    workspaceRoot: "/workspace/fleet",
    repositoryIdentity: null,
    defaultModelSelection: { instanceId: fallback.instanceId, model: "fallback-model" },
    scripts: [],
    createdAt: "2026-11-03T12:00:00Z",
    updatedAt: "2026-11-03T12:00:00Z",
  } satisfies EnvironmentProject;
  await screen.rerender(header(REMOTE, project));
  await expect
    .element(screen.getByRole("button", { name: /^Model: Available fallback/ }))
    .toBeVisible();
  await act(() =>
    fixture.setProviders(REMOTE, [
      {
        ...fallback,
        models: [
          ...fallback.models,
          {
            slug: "configured-model",
            name: "Configured default",
            isCustom: false,
            capabilities: null,
          },
        ],
      },
    ]),
  );
  await screen.rerender(
    header(REMOTE, project, { instanceId: fallback.instanceId, model: "configured-model" }),
  );
  await expect
    .element(screen.getByRole("button", { name: /^Model: Configured default/ }))
    .toBeVisible();
  await screen.rerender(
    header(
      REMOTE,
      project,
      { instanceId: fallback.instanceId, model: "configured-model" },
      { thread: unlistedThread, draftTarget: scopeThreadRef(REMOTE, THREAD) },
    ),
  );
  await expect
    .element(screen.getByRole("button", { name: /^Model: Available fallback/ }))
    .toBeVisible();
});
