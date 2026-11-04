import type { PreviewStreamEvents } from "@t3tools/client-runtime/preview/server-browser-stream";
import {
  type BetterWrightViewerFallbackAvailability,
  type BetterWrightViewerFallbackBridge,
  type BetterWrightViewerFallbackState,
  EnvironmentId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import "../index.css";

const LEASE_URL =
  "ws://gwdg.test/api/betterwright-viewer-fallback/ws?threadId=thread-1&tabId=tab-1&wsTicket=t";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn<(target: unknown, handlers: PreviewStreamEvents) => unknown>(),
  bridge: null as BetterWrightViewerFallbackBridge | null,
  listener: null as ((state: BetterWrightViewerFallbackState) => void) | null,
  availability: null as BetterWrightViewerFallbackAvailability | null,
  canOperate: true,
  open: vi.fn<BetterWrightViewerFallbackBridge["open"]>(),
  complete: vi.fn<BetterWrightViewerFallbackBridge["complete"]>(),
}));

vi.mock(import("@t3tools/client-runtime/preview/server-browser-stream"), async (original) => ({
  ...(await original()),
  createPreviewStreamClient: mocks.createClient as never,
  createPreviewFramePainter: () => ({ paint: () => undefined, stop: () => undefined }),
}));
vi.mock(import("~/state/previewStream"), async (original) => ({
  ...(await original()),
  usePreviewStreamAccess: () => ({ httpBase: "", wsBase: "", query: {}, credentials: false }),
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => mocks.canOperate,
}));
vi.mock(import("./betterWrightSshFallbackAccess"), () => ({
  readViewerFallbackLeaseUrl: async () => LEASE_URL,
  viewerFallbackBridge: () => mocks.bridge ?? undefined,
}));

import { ServerBrowserSurface } from "./ServerBrowserSurface";

const environmentId = EnvironmentId.make("environment-gwdg");
const state = (phase: BetterWrightViewerFallbackState["phase"], message: string | null = null) => ({
  sessionId: "session-1",
  environmentId,
  threadId: "thread-1",
  tabId: "tab-1",
  phase,
  message,
});
const capture = (name: string, container: HTMLElement) =>
  import.meta.env.VITE_SSH_FALLBACK_CAPTURE
    ? page
        .elementLocator(container)
        .screenshot({ path: `../../../../.t3/ssh-fallback-evidence/${name}.png` })
    : Promise.resolve();

function setup(options: {
  desktop: boolean;
  availability: BetterWrightViewerFallbackAvailability;
}) {
  mocks.availability = options.availability;
  mocks.canOperate = true;
  mocks.listener = null;
  mocks.open.mockReset().mockResolvedValue({ sessionId: "session-1" });
  mocks.complete.mockReset().mockResolvedValue(undefined);
  mocks.createClient
    .mockReset()
    .mockImplementation(() => ({ send: () => false, stop: () => undefined }));
  mocks.bridge = options.desktop
    ? {
        availability: async () => mocks.availability!,
        open: mocks.open,
        complete: mocks.complete,
        close: async () => undefined,
        sessions: async () => [],
        onState: (listener) => {
          mocks.listener = listener;
          return () => {
            mocks.listener = null;
          };
        },
      }
    : null;
}

const surface = (visible: boolean) => (
  <ServerBrowserSurface
    environmentId={environmentId}
    threadId="thread-1"
    tabId="tab-1"
    visible={visible}
    followSize={false}
    className="flex-1"
  />
);

async function renderFailingStream() {
  const container = document.createElement("div");
  container.style.cssText = "width: 520px; height: 340px; display: flex;";
  await using stack = new AsyncDisposableStack();
  // Hidden first, so the health sampler starts under the fake clock below.
  const screen = stack.use(await render(surface(false), { container }));
  stack.use(fakeTimers());
  await screen.rerender(surface(true));
  await vi.waitFor(() => expect(mocks.createClient).toHaveBeenCalled());
  const handlers = mocks.createClient.mock.calls.at(-1)![1];
  const moved = stack.move();
  return { screen, container, handlers, [Symbol.asyncDispose]: () => moved.disposeAsync() };
}

describe("BetterWright SSH viewer fallback", () => {
  it("offers SSH only after the stream fails, then opens, completes and reports the lease", async () => {
    setup({ desktop: true, availability: { available: true, sshHost: "gwdg" } });
    await using view = await renderFailingStream();
    await act(() => view.handlers.onConnectedChange(true));
    await act(() => vi.advanceTimersByTime(8_000));
    await expect.element(page.getByText(/Open over SSH/)).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTime(6_000));
    const open = view.screen.getByRole("button", { name: "Open over SSH" });
    await expect.element(open).toBeVisible();
    await expect.element(view.screen.getByText(/through gwdg/)).toBeVisible();
    await capture("offer", view.container);

    await userEvent.click(open);
    await vi.waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({
        environmentId,
        threadId: "thread-1",
        tabId: "tab-1",
        leaseUrl: LEASE_URL,
      }),
    );
    await act(() => mocks.listener?.(state("connecting")));
    await expect.element(view.screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    await act(() => mocks.listener?.(state("open")));
    const done = view.screen.getByRole("button", { name: "Done, release to agent" });
    await expect.element(done).toBeVisible();
    await capture("open", view.container);
    await userEvent.click(done);
    expect(mocks.complete).toHaveBeenCalledWith("session-1");

    await act(() =>
      mocks.listener?.(
        state(
          "failed",
          "The connection to the T3 server dropped, so the SSH viewer was closed to keep control with T3.",
        ),
      ),
    );
    await expect.element(view.screen.getByText(/keep control with T3/)).toBeVisible();
    await capture("dropped", view.container);
  });

  it("explains a missing SSH route and never offers a way around a refused stream", async () => {
    setup({
      desktop: true,
      availability: {
        available: false,
        reason:
          "Opening this browser over SSH needs an SSH connection saved for this environment in Settings → Connections.",
      },
    });
    {
      await using view = await renderFailingStream();
      await act(() => vi.advanceTimersByTime(14_000));
      await expect.element(view.screen.getByText(/needs an SSH connection saved/)).toBeVisible();
      await expect
        .element(view.screen.getByRole("button", { name: "Open over SSH" }))
        .not.toBeInTheDocument();
      await capture("unavailable", view.container);
    }

    setup({ desktop: true, availability: { available: true, sshHost: "gwdg" } });
    {
      await using view = await renderFailingStream();
      await act(() => view.handlers.onUnauthorized());
      await act(() => vi.advanceTimersByTime(60_000));
      await expect.element(page.getByText(/Open over SSH/)).not.toBeInTheDocument();
    }

    setup({ desktop: true, availability: { available: true, sshHost: "gwdg" } });
    mocks.canOperate = false;
    {
      await using _view = await renderFailingStream();
      await act(() => vi.advanceTimersByTime(60_000));
      await expect.element(page.getByText(/Open over SSH/)).not.toBeInTheDocument();
    }

    setup({ desktop: false, availability: { available: true, sshHost: "gwdg" } });
    {
      await using view = await renderFailingStream();
      await act(() => vi.advanceTimersByTime(60_000));
      await expect.element(page.getByText(/over SSH/)).not.toBeInTheDocument();
      expect(view.container.querySelector("[data-testid=betterwright-ssh-fallback]")).toBeNull();
    }
  });
});
