import { BrowserProxyError, type ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { useOpenLink } from "./useOpenLink";

const mocks = vi.hoisted(() => ({ open: vi.fn(), external: vi.fn(), toast: vi.fn() }));

vi.mock("./openFileInPreview", () => ({
  openUrlInPreview: mocks.open,
  BrowserSettingsReadError: class extends Error {},
}));
vi.mock("./browserLinkTarget", () => ({
  canOpenLinksInApp: () => true,
  resolveBrowserLinkTargetPreference: async () => "app",
  resolveLinkTarget: () => "app",
}));
vi.mock("~/browserHistoryStore", () => ({ recordVisitForThread: vi.fn() }));
vi.mock("~/state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("~/state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ shell: { openExternal: mocks.external } }),
}));

it("does not open the system browser after a proxy failure", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const threadRef = { environmentId: "host", threadId: "thread" } as ScopedThreadRef;
  for (const proxy of [true, false]) {
    mocks.open.mockReset();
    mocks.external.mockReset().mockResolvedValue(undefined);
    mocks.toast.mockReset();
    mocks.open.mockResolvedValue(
      AsyncResult.failure(
        Cause.fail(
          proxy
            ? new BrowserProxyError({ message: "Proxy unavailable." })
            : new Error("Direct preview failed."),
        ),
      ),
    );
    await useOpenLink(threadRef)("https://example.com");
    expect(mocks.external).toHaveBeenCalledTimes(proxy ? 0 : 1);
    expect(mocks.toast).toHaveBeenCalledTimes(proxy ? 1 : 0);
  }
});
