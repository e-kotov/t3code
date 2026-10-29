import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import type { PreviewStreamControl } from "@t3tools/client-runtime/preview/server-browser-stream";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { toastManager } from "~/components/ui/toast";
import { getClientSettings, __setClientSettingsForTests } from "~/hooks/useSettings";
import { PreviewView } from "./PreviewView";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  remember: vi.fn(),
  visit: vi.fn(),
  control: undefined as ((control: PreviewStreamControl | null) => void) | undefined,
}));
const threadRef = { environmentId: EnvironmentId.make("host"), threadId: ThreadId.make("thread") };
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab",
  runtime: "server",
  headless: true,
  proxyUrl: "socks5://proxy:1080",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-29T00:00:00.000Z",
};

vi.mock(import("~/previewStateStore"), async (original) => ({
  ...(await original()),
  rememberPreviewUrl: state.remember,
  useThreadPreviewState: (() => ({
    activeTabId: "tab",
    serverEpoch: null,
    desktopByTabId: {},
    recentlySeenUrls: [],
    sessions: { tab: snapshot },
  })) as never,
}));
vi.mock(import("~/browserHistoryStore"), async (original) => ({
  ...(await original()),
  recordVisitForThread: state.visit,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => ({ label: "Host" })) as never,
  useEnvironmentHttpBaseUrl: () => "https://host.example",
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("./useDiscoveredLocalServers"), () => ({ useDiscoveredLocalServers: () => [] }));
vi.mock(import("./usePreviewSession"), () => ({ usePreviewSession: () => {} }));
vi.mock(import("~/browser/ServerBrowserSurface"), async () => {
  const { useImperativeHandle } = await import("react");
  type Props = ComponentProps<typeof import("~/browser/ServerBrowserSurface").ServerBrowserSurface>;
  return {
    ServerBrowserSurface: (props: Props) => {
      state.control = props.onControl;
      useImperativeHandle(props.ref, () => ({
        navigate: state.navigate,
        history: vi.fn(),
        reload: vi.fn(),
        viewport: vi.fn(),
        canvas: () => null,
      }));
      return <div />;
    },
  };
});

it("reports local navigation from a blank proxy tab without changing page or history", async () => {
  state.navigate.mockReset();
  state.remember.mockReset();
  state.visit.mockReset();
  state.control = undefined;
  using settings = new DisposableStack();
  const previous = getClientSettings();
  __setClientSettingsForTests(previous);
  settings.defer(() => __setClientSettingsForTests(previous));
  await using screen = await render(<PreviewView threadRef={threadRef} tabId="tab" visible />);
  using toast = vi.spyOn(toastManager, "add").mockReturnValue("proxy-error");
  await act(() => {
    state.control?.({ canOperate: true, controller: "you", generation: 1, dialog: null });
  });
  const address = screen.getByRole("textbox", { name: "Search or enter URL" });
  await expect.element(address).toBeEnabled();
  await userEvent.fill(address, "http://localhost:5173");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(toast.mock.calls[0]?.[0]).toMatchObject({
    type: "error",
    title: "Browser proxy unavailable",
  });
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.remember).not.toHaveBeenCalled();
  expect(state.visit).not.toHaveBeenCalled();
  await expect.element(address).toHaveValue("");

  await userEvent.fill(address, "https://example.com/page");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledWith("https://example.com/page"));
  expect(state.visit).toHaveBeenCalledWith(threadRef, "https://example.com/page");
});
