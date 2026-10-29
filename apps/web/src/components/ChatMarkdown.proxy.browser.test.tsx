import { BrowserProxyError, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { getClientSettings, __setClientSettingsForTests } from "../hooks/useSettings";
import { toastManager } from "./ui/toast";
import ChatMarkdown from "./ChatMarkdown";

const state = vi.hoisted(() => ({ open: vi.fn(), external: vi.fn(), report: vi.fn() }));

vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.open) as never,
}));
vi.mock(import("../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
vi.mock(import("../remoteOpen"), async (original) => ({
  ...(await original()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }) as never,
}));
vi.mock(import("../browser/previewRuntime"), async (original) => ({
  ...(await original()),
  isPreviewAvailableFor: () => true,
}));
vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ shell: { openExternal: state.external } }) as never,
}));
vi.mock("./chat/markdownActionFailure", () => ({ reportMarkdownActionFailure: state.report }));

function setup() {
  using stack = new DisposableStack();
  const settings = getClientSettings();
  __setClientSettingsForTests({ ...settings, browserLinkTarget: "app" });
  stack.defer(() => __setClientSettingsForTests(settings));
  state.open.mockReset();
  state.external.mockReset().mockResolvedValue(undefined);
  state.report.mockReset();
  return stack.move();
}

it("keeps chat links out of the system browser after proxy failures", async () => {
  using _setup = setup();
  const threadRef = {
    environmentId: EnvironmentId.make("host"),
    threadId: ThreadId.make("thread"),
  };
  await using screen = await render(
    <ChatMarkdown cwd="/work" threadRef={threadRef} text="[Open site](https://example.com)" />,
  );
  using toast = vi.spyOn(toastManager, "add").mockReturnValue("proxy-error");
  for (const proxy of [true, false]) {
    state.open.mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(
          proxy
            ? new BrowserProxyError({ message: "Proxy unavailable." })
            : new Error("Direct preview failed."),
        ),
      ),
    );
    await userEvent.click(screen.getByRole("link", { name: "Open site" }));
    await vi.waitFor(() => expect(state.report).toHaveBeenCalledTimes(1));
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(state.external).toHaveBeenCalledTimes(proxy ? 0 : 1);
    expect(toast).toHaveBeenCalledTimes(proxy ? 1 : 0);
    state.open.mockClear();
    state.external.mockClear();
    state.report.mockClear();
    toast.mockClear();
  }
});
