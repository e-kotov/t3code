import type { EnvironmentConnectionPhase, EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProviderDriverKind, ProviderInstanceId, ThreadId, type ScopedThreadRef, type ServerProvider } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { ChatHeader } from "./ChatHeader";
import "../../index.css";

const fixture = vi.hoisted(() => ({
  presentations: new Map<string, EnvironmentPresentation>(),
  providers: new Map<string, ReadonlyArray<ServerProvider>>(),
  shells: new Map<string, EnvironmentThreadShell>(),
}));

vi.mock(import("../../state/presentation"), async (original) => ({
  ...(await original()),
  useEnvironmentPresentation: (id: EnvironmentId | null) => ({
    isReady: true,
    presentation: id ? fixture.presentations.get(id) ?? null : null,
  }),
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (ref: ScopedThreadRef | null) => ref ? fixture.shells.get(ref.environmentId) ?? null : null,
}));
vi.mock(import("../../state/server"), async (original) => {
  const { Atom } = await import("effect/reactivity");
  return {
    ...(await original()),
    providersIgnoringCheckedAtAtom: (id: EnvironmentId) => Atom.make(fixture.providers.get(id) ?? []),
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
    models: [{ slug: "shared-model", name, shortName: name, isCustom: false, capabilities: null }],
  };
}

function setup() {
  fixture.presentations.clear();
  fixture.providers.clear();
  fixture.shells.clear();
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  for (const [id, label, modelName] of [[MAC, "Mac", "GPT-6.1 Sol"], [REMOTE, "GWDG", "Remote custom model"]] as const) {
    fixture.presentations.set(id, presentation(label, "connected"));
    fixture.providers.set(id, [provider(modelName)]);
    fixture.shells.set(id, {
      modelSelection: { instanceId: INSTANCE, model: "shared-model" },
      runtime: null,
      projectId: null,
    } as unknown as EnvironmentThreadShell);
  }
}

function header(environmentId = REMOTE) {
  return (
    <div className="flex h-12 w-full items-center bg-background px-3" data-testid="header-context">
      <ChatHeader
        activeThreadEnvironmentId={environmentId}
        activeThreadId={THREAD}
        activeThreadTitle="Header indicators"
        isServerThread={false}
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        onNewThreadInProject={() => {}}
      />
    </div>
  );
}

it("follows the active machine through pending, recovery and a later disconnect", async () => {
  setup();
  await page.viewport(1000, 260);
  await using screen = await render(header());
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE === "before") {
    await screen.getByTestId("header-context").screenshot({ path: "../../../../../.t3/header-evidence/before-header.png" });
    return;
  }
  await expect.element(screen.getByRole("button", { name: "Machine: GWDG. Connected" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Model: Remote custom model/ })).toBeVisible();
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
    await screen.getByTestId("header-context").screenshot({ path: "../../../../../.t3/header-evidence/after-header.png" });
  }
  for (const phase of ["connecting", "reconnecting", "connected", "offline", "reconnecting", "connected"] as const) {
    fixture.presentations.set(REMOTE, presentation("GWDG", phase));
    await screen.rerender(header());
    const pending = phase === "connecting" || phase === "reconnecting";
    expect(screen.container.querySelector("[data-header-machine] .bg-warning") !== null).toBe(pending);
    expect(screen.container.querySelector("[data-header-machine] .motion-safe\\:animate-status-ping") !== null).toBe(pending);
    if (pending) await expect.element(screen.getByRole("button", { name: `GWDG is ${phase}` })).toBeVisible();
    if (phase === "reconnecting" && import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
      await screen.getByTestId("header-context").screenshot({ path: "../../../../../.t3/header-evidence/reconnecting.png" });
    }
  }
  await screen.rerender(header(MAC));
  await expect.element(screen.getByRole("button", { name: "Machine: Mac. Connected" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Model: GPT-6.1 Sol/ })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /GWDG/ })).not.toBeInTheDocument();
});

it("updates an unsent model choice and clears the previous machine's model when switching", async () => {
  setup();
  await page.viewport(390, 260);
  await using screen = await render(header());
  await act(() => useComposerDraftStore.getState().setModelSelection(
    scopeThreadRef(REMOTE, THREAD), { instanceId: INSTANCE, model: "private-custom-slug" },
  ));
  await expect.element(screen.getByRole("button", { name: /^Model: private-custom-slug/ })).toBeVisible();
  await screen.rerender(header(MAC));
  await expect.element(screen.getByRole("button", { name: /^Model: GPT-6.1 Sol/ })).toBeVisible();
  expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
  if (import.meta.env.VITE_HEADER_CONTEXT_CAPTURE) {
    await screen.getByTestId("header-context").screenshot({ path: "../../../../../.t3/header-evidence/narrow.png" });
  }
});
