import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listener: vi.fn(),
  native: {
    isAvailable: () => true,
    getConfig: () => ({ enabled: true, position: "first", signedIn: true, idleTimeoutSeconds: 300 }),
    status: vi.fn<() => Promise<string>>(),
    phoneShareStatus: vi.fn<() => { enabled: boolean; status: string }>(),
  },
}));

vi.mock("expo", () => ({ requireOptionalNativeModule: (name: string) => name === "T3Tailnet" ? mocks.native : null }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" }, Platform: { OS: "android" } }));
vi.mock("react", () => ({
  useEffect: vi.fn(),
  useSyncExternalStore: (subscribe: (listener: () => void) => unknown, getSnapshot: () => unknown) => {
    subscribe(mocks.listener);
    return getSnapshot();
  },
}));

import { refreshBuiltInTailnetStatus, useBuiltInTailnet } from "./builtInTailnet";

it("publishes node and phone-sharing changes in one status update", async () => {
  mocks.listener.mockClear();
  mocks.native.status.mockResolvedValue(JSON.stringify({ ok: true, result: { state: "running", forwards: [] } }));
  mocks.native.phoneShareStatus.mockReturnValue({ enabled: true, status: "Available on your tailnet" });
  useBuiltInTailnet();
  await refreshBuiltInTailnetStatus();
  expect(mocks.listener).toHaveBeenCalledTimes(1);
  expect(useBuiltInTailnet()).toMatchObject({
    status: { state: "running" },
    phoneShare: { enabled: true, status: "Available on your tailnet" },
  });
});

it("keeps the sharing failure visible when the node status query fails", async () => {
  mocks.listener.mockClear();
  mocks.native.status.mockResolvedValue(JSON.stringify({ ok: false, error: "Node unavailable" }));
  mocks.native.phoneShareStatus.mockReturnValue({ enabled: false, status: "The phone T3 server stopped" });
  useBuiltInTailnet();
  await refreshBuiltInTailnetStatus();
  expect(mocks.listener).toHaveBeenCalledTimes(1);
  expect(useBuiltInTailnet()).toMatchObject({
    error: "Node unavailable",
    phoneShare: { enabled: false, status: "The phone T3 server stopped" },
  });
});
