import { BrowserProxyError, type ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { useOpenLink } from "./useOpenLink";

const mocks = vi.hoisted(() => ({ open: vi.fn(), external: vi.fn(), toast: vi.fn() }));

vi.mock("./openFileInPreview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openFileInPreview")>();
  return { ...actual, openUrlInPreview: mocks.open };
});
vi.mock("./browserLinkTarget", () => ({
  canOpenLinksInApp: () => true,
  resolveBrowserLinkTargetPreference: async () => "app",
  resolveLinkTarget: () => "app",
}));
vi.mock("~/env", () => ({ isElectron: false }));
vi.mock("~/state/environments", () => ({ useEnvironment: () => null }));
vi.mock("~/state/portForwards", () => ({ useForwardLocality: () => "unknown" }));
vi.mock("./browserTargetResolver", () => ({
  resolveReachableExternalServerUrl: (environmentId: string, url: string) =>
    url.replace("localhost", environmentId + ".tailnet.test"),
}));
vi.mock("~/browserHistoryStore", () => ({ recordVisitForThread: vi.fn() }));
vi.mock("~/state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("~/state/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/state/session")>();
  return { ...actual, readEnvironmentScope: () => true, useEnvironmentScope: () => false };
});
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

it("uses the selected thread's machine for a loopback fallback", async () => {
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const origin = { environmentId: "origin", threadId: "thread" } as ScopedThreadRef;
  const selected = { ...origin, environmentId: "selected" } as ScopedThreadRef;
  mocks.open
    .mockReset()
    .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Preview failed."))));
  mocks.external.mockReset().mockResolvedValue(undefined);
  await useOpenLink(origin)("http://localhost:8080/view", { threadRef: selected });
  expect(mocks.external).toHaveBeenCalledExactlyOnceWith("http://selected.tailnet.test:8080/view");
});
